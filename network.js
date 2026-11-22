"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const sbClient = (window.supabase && window.supabase.createClient)
    ? window.supabase.createClient(K.CONFIG.SUPABASE_URL, K.CONFIG.SUPABASE_KEY, {
        realtime: { params: { eventsPerSecond: 10 } },
      })
    : null;

  const localBus = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("kameen_sync_v3")
    : null;

  function updateConnectionBadges() {
    const mapTxt = {
      connected: "متصل لايف",
      connecting: "جاري الربط...",
      ready: "جاهز",
      error: "وضع محلي",
      offline: "وضع محلي",
    };
    const txt = mapTxt[K.state.sbStatus] || "جاهز";
    document.querySelectorAll(".sb-status-badge").forEach((el) => {
      el.textContent = txt;
    });
  }

  function disconnectRoomChannel() {
    const st = K.state;
    if (st.joinTimeout) { clearTimeout(st.joinTimeout); st.joinTimeout = null; }
    if (st.roomChannel && sbClient) {
      try { sbClient.removeChannel(st.roomChannel); } catch {}
    }
    st.roomChannel = null;
    st.joinedCode = null;
    st.sbStatus = sbClient ? "ready" : "offline";
    updateConnectionBadges();
  }

  function connectRoomChannel(code, onSubscribed) {
    const st = K.state;
    const cleanCode = code.trim().toUpperCase();
    if (st.roomChannel && st.joinedCode === cleanCode) {
      if (onSubscribed) onSubscribed();
      return;
    }
    disconnectRoomChannel();
    st.joinedCode = cleanCode;

    if (!sbClient) {
      st.sbStatus = "offline";
      updateConnectionBadges();
      if (onSubscribed) onSubscribed();
      return;
    }

    st.sbStatus = "connecting";
    updateConnectionBadges();

    const ch = sbClient.channel("kameen_room_" + cleanCode, {
      config: { broadcast: { self: false } },
    });

    ch.on("broadcast", { event: "JOIN_REQ" }, ({ payload }) => {
      if (!st.lobby || st.lobby.hostId !== st.user.id || !payload?.player) return;
      const exists = st.lobby.players.find((p) => p.id === payload.player.id);
      if (!exists) {
        st.lobby.players.push({
          ...payload.player,
          isBot: false, isHost: false, isReady: true,
          coords: payload.player.coords || st.lobby.center,
        });
        K.SFX.play("intel");
        K.showToast(`👋 ${payload.player.name} دخل اللوبي!`);
      } else {
        exists.name = payload.player.name;
      }
      broadcastLobbyState();
      if (st.route === "lobby") K.UI.renderPage();
      if (st.lobby.started && st.engine) broadcastMatchSnapshot(true);
    });

    ch.on("broadcast", { event: "LEAVE_REQ" }, ({ payload }) => {
      if (!st.lobby || st.lobby.hostId !== st.user.id || !payload?.playerId) return;
      st.lobby.players = st.lobby.players.filter((p) => p.id !== payload.playerId);
      broadcastLobbyState();
      if (st.route === "lobby") K.UI.renderPage();
    });

    ch.on("broadcast", { event: "SPECTATOR_REQ" }, ({ payload }) => {
      if (!st.lobby || st.lobby.hostId !== st.user.id || !payload?.playerId) return;
      const tgt = st.lobby.players.find((p) => p.id === payload.playerId);
      if (tgt) {
        tgt.isSpectator = Boolean(payload.isSpectator);
        broadcastLobbyState();
        if (st.route === "lobby") K.UI.renderPage();
      }
    });

    ch.on("broadcast", { event: "LOBBY_SYNC" }, ({ payload }) => {
      if (!payload || !payload.lobby) return;
      if (st.lobby && st.lobby.hostId === st.user.id) return;
      if (st.joinTimeout) { clearTimeout(st.joinTimeout); st.joinTimeout = null; }
      const stillIn = payload.lobby.players.some((p) => p.id === st.user.id);
      if (!stillIn && st.lobby && st.route === "lobby") {
        K.showToast("🚪 الريس طلعك من اللوبي");
        disconnectRoomChannel();
        st.lobby = null;
        K.App.navigate("landing");
        return;
      }
      st.lobby = payload.lobby;
      if (st.lobby.started && payload.snapshot) {
        st.isSimMode = false;
        st.engine = K.KameenEngine.fromSnapshot(payload.snapshot);
        st.simTimeMs = payload.snapshot.nowMs;
        st.roleRevealed = false;
        st.roleFlipped = false;
        st.eliminatedAck = false;
        K.App.startEngineLoop();
        K.App.navigate("game");
      } else if (st.route !== "lobby") {
        K.App.navigate("lobby");
      } else {
        K.UI.renderPage();
      }
    });

    ch.on("broadcast", { event: "MATCH_SYNC" }, ({ payload }) => {
      if (!payload || !payload.snapshot) return;
      if (K.App.isMatchHost()) return;
      K.App.applyRemoteSnapshot(payload.snapshot);
    });

    ch.on("broadcast", { event: "ACTION_REQ" }, ({ payload }) => {
      if (!K.App.isMatchHost() || !st.engine || !payload) return;
      void K.App.handleAuthoritativeAction(payload.playerId, payload.type, payload.data, true);
    });

    ch.on("broadcast", { event: "ACTION_RES" }, ({ payload }) => {
      if (!payload || payload.playerId !== st.user.id) return;
      if (!payload.ok && payload.error) K.showToast(payload.error);
      if (payload.ok && payload.toast) K.showToast(payload.toast);
      if (payload.intelText) {
        st.lastIntel = payload.intelText;
        K.SFX.play("intel");
        if (st.route === "game" || st.route === "simulation") K.UI.updateHudOnly();
      }
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        st.sbStatus = "connected";
        updateConnectionBadges();
        if (onSubscribed) onSubscribed();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        st.sbStatus = "error";
        updateConnectionBadges();
      }
    });

    st.roomChannel = ch;
  }

  function broadcastLobbyState() {
    const st = K.state;
    if (!st.lobby) return;
    try { localStorage.setItem("kameen_lobby_" + st.lobby.code, JSON.stringify(st.lobby)); } catch {}
    const payload = {
      lobby: st.lobby,
      snapshot: st.lobby.started && st.engine ? st.engine.getSnapshot() : null,
    };
    if (localBus) localBus.postMessage({ type: "LOBBY_SYNC", code: st.lobby.code, payload });
    if (st.roomChannel && st.sbStatus === "connected") {
      st.roomChannel.send({ type: "broadcast", event: "LOBBY_SYNC", payload });
    }
  }

  function broadcastMatchSnapshot(force = false) {
    const st = K.state;
    if (!st.engine || st.isSimMode || !K.App.isMatchHost()) return;
    const now = Date.now();
    if (!force && now - st.lastSyncBroadcastAt < 1100) return;
    st.lastSyncBroadcastAt = now;
    const snap = st.engine.getSnapshot();
    try { localStorage.setItem("kameen_match_" + snap.code, JSON.stringify(snap)); } catch {}
    if (localBus) localBus.postMessage({ type: "MATCH_SYNC", code: snap.code, snapshot: snap });
    if (st.roomChannel && st.sbStatus === "connected") {
      st.roomChannel.send({ type: "broadcast", event: "MATCH_SYNC", payload: { snapshot: snap } });
    }
  }

  function sendRaw(event, payload) {
    const st = K.state;
    if (st.roomChannel && st.sbStatus === "connected") {
      st.roomChannel.send({ type: "broadcast", event, payload });
    }
    if (localBus && st.joinedCode) {
      localBus.postMessage({ type: event, code: st.joinedCode, payload });
    }
  }

  if (localBus) {
    localBus.onmessage = (ev) => {
      const st = K.state;
      if (!st) return;
      const d = ev.data || {};
      if (d.type === "LOBBY_SYNC" && st.joinedCode === d.code) {
        if (st.lobby && st.lobby.hostId === st.user.id) return;
        st.lobby = d.payload.lobby;
        if (st.lobby.started && d.payload.snapshot) {
          st.isSimMode = false;
          st.engine = K.KameenEngine.fromSnapshot(d.payload.snapshot);
          st.simTimeMs = d.payload.snapshot.nowMs;
          st.roleRevealed = false;
          st.roleFlipped = false;
          st.eliminatedAck = false;
          K.App.startEngineLoop();
          K.App.navigate("game");
        } else if (st.route === "lobby") {
          K.UI.renderPage();
        }
      }
      if (d.type === "MATCH_SYNC" && st.engine && st.engine.getSnapshot().code === d.code && !K.App.isMatchHost()) {
        K.App.applyRemoteSnapshot(d.snapshot);
      }
      if (d.type === "ACTION_REQ" && K.App.isMatchHost() && st.engine && st.engine.getSnapshot().code === d.code) {
        void K.App.handleAuthoritativeAction(d.payload.playerId, d.payload.type, d.payload.data, true);
      }
    };
  }

  K.Network = {
    hasSupabase: Boolean(sbClient),
    connectRoomChannel,
    disconnectRoomChannel,
    broadcastLobbyState,
    broadcastMatchSnapshot,
    sendRaw,
    updateConnectionBadges,
  };
})(window.Kameen);
