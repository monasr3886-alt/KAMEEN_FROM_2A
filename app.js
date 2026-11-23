"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const storedUid = localStorage.getItem("kameen_uid") || ("p-" + Math.random().toString(36).slice(2, 8));
  try { localStorage.setItem("kameen_uid", storedUid); } catch {}
  const storedName = localStorage.getItem("kameen_name") || "العميل X";
  const stats = K.loadStats();
  const permsDone = localStorage.getItem("kameen_perms_v4") === "1";

  K.state = {
    route: permsDone ? "landing" : "permissions_gate",
    mapStyle: "radar_streets",
    user: {
      id: storedUid,
      name: storedName,
      matchesPlayed: stats.played,
      matchesWon: stats.won,
      missionsCompleted: stats.missions,
      kills: stats.kills || 0,
    },
    gps: {
      coords: { ...K.CONFIG.DEFAULT_CENTER },
      accuracy: null,
      rawAccuracy: null,
      heading: null,
      headingSource: null,
      compassActive: false,
      motionActive: false,
      hasRealFix: false,
      status: "idle",
      error: null,
      centeredOnce: false,
      bestCenterAcc: Infinity,
      userPickedZone: false,
      anchorCalibrating: false,
      lastFixAt: 0,
      lastSentAt: 0,
    },
    camera: { status: "idle", error: null, facingMode: "environment", ready: false, recording: false, recSec: 0, maxRecSec: 8 },
    groqKey: (() => { const s = String(localStorage.getItem("kameen_groq_key") || "").replace(/[^\x21-\x7E]/g, "").trim(); return (s.startsWith("gsk_") && s.length >= 20) ? s : K.CONFIG.DEFAULT_GROQ_KEY; })(),
    sbStatus: K.Network.hasSupabase ? "ready" : "offline",
    roomChannel: null,
    joinedCode: null,
    joinTimeout: null,
    createForm: {
      title: "كمين الشلة",
      center: { ...K.CONFIG.DEFAULT_CENTER },
      radius: 250,
      duration: 15,
      spreadSeconds: 60,
      imposters: 1,
      revealIntervalSec: K.GAME_CONSTANTS.DEFAULT_REVEAL_INTERVAL_SEC,
      revealMode: K.GAME_CONSTANTS.DEFAULT_REVEAL_MODE,
      pois: [],
      poiSource: null,
    },
    lobby: null,
    joinCode: "",
    engine: null,
    isSimMode: false,
    simUseRealGps: true,
    simSpeed: 1,
    simRunning: true,
    simDpadVisible: false,
    mapFollowMe: true,
    mapRotateWithMe: false,
    simTimeMs: Date.now(),
    roleRevealed: false,
    roleFlipped: false,
    eliminatedAck: false,
    lastIntel: null,
    lastBrokerIdNotified: null,
    lastAirdropIdNotified: null,
    lastPingSweepNotified: 0,
    aiBusy: false,
    videoAnalyzing: false,
    videoVerdict: null,
    videoVerdictTone: "pending",
    modal: null,
    activeCameraMissionId: null,
    toast: null,
    toastTimer: null,
    glMap: null,
    selfMarker: null,
    selfMarkerColorKey: null,
    tickTimer: null,
    lastSyncBroadcastAt: 0,
    lastLobbyLocAt: 0,
    recordedGameOverId: null,
    strictLiveCamera: localStorage.getItem("kameen_strict_cam") === "1",
    pocketMode: false,
    lastPocketTapAt: 0,
    deferredInstallPrompt: null,
    intelTab: "public",
    meetingIntelTab: "public",
    privateScanOpen: false,
    lastReadLiveChatCount: 0,
    lastLiveChatSeenId: null,
    lastChatBanner: null,
  };

  function isMatchHost() {
    const st = K.state;
    if (st.isSimMode) return true;
    if (st.engine) return st.engine.getSnapshot().hostId === st.user.id;
    if (st.lobby) return st.lobby.hostId === st.user.id;
    return true;
  }

  function headingToArabic(deg) {
    return K.Location.headingToArabic(deg);
  }

  function computeBearingDeg(from, to) {
    return K.Location.computeBearingDeg(from, to);
  }

  function applyHeading(rawDeg, source) {
    K.Location.setManualHeading(rawDeg, source);
  }

  async function startCompass(fromUserGesture = false) {
    const res = await K.Location.enableSensors(fromUserGesture);
    const st = K.state;
    st.gps.compassActive = Boolean(res.compassOk);
    st.gps.motionActive = Boolean(res.motionOk);
  }

  function onFusedLocationUpdate(nextCoords, tele) {
    const st = K.state;
    const now = Date.now();
    const isFirstRealFix = !st.gps.hasRealFix;

    st.gps.status = "granted";
    st.gps.error = null;
    st.gps.hasRealFix = true;
    st.gps.lastFixAt = now;
    st.gps.accuracy = nextCoords.fusedAccuracy ?? nextCoords.accuracyMeters;
    st.gps.rawAccuracy = tele.rawAcc;
    st.gps.compassActive = tele.compassActive;
    st.gps.motionActive = tele.motionActive;

    const useRealHere = !st.isSimMode || st.simUseRealGps;
    if (useRealHere) {
      st.gps.coords = nextCoords;
    }

    const rawAcc = tele.rawAcc || 20;
    if (isFirstRealFix || (!st.gps.userPickedZone && rawAcc + 3 < st.gps.bestCenterAcc && st.route === "create")) {
      st.gps.bestCenterAcc = rawAcc;
      st.createForm.center = { ...nextCoords };
      if (useRealHere) K.Map.flyTo(nextCoords, 18.2, !isFirstRealFix);
      if (st.route === "create") void K.Map.fetchOverpassPOIs(nextCoords, st.createForm.radius);
      st.gps.centeredOnce = true;
    }

    if (useRealHere && (st.route === "game" || st.route === "simulation" || st.route === "create")) {
      K.Map.setSelfLiveCoords(nextCoords, true);
    }

    if (st.engine && useRealHere && now - st.gps.lastSentAt >= 700) {
      st.gps.lastSentAt = now;
      dispatchAction("UPDATE_LOC", { coords: nextCoords });
    } else if (st.route === "lobby" && st.lobby && now - st.lastLobbyLocAt >= 3000) {
      st.lastLobbyLocAt = now;
      const me = st.lobby.players.find((p) => p.id === st.user.id);
      if (me) {
        me.coords = nextCoords;
        me.hasRealFix = true;
        if (st.lobby.hostId === st.user.id) {
          K.Network.broadcastLobbyState();
          K.UI.updateLobbyDynamic();
        } else {
          K.Network.sendRaw("LOBBY_LOC", { playerId: st.user.id, coords: nextCoords, hasRealFix: true });
        }
      }
    }

    K.UI.updateGpsStatusDOM();
  }

  function onFusedHeadingUpdate(deg, source) {
    const st = K.state;
    st.gps.heading = deg;
    st.gps.headingSource = source;
    if (source === "compass" || source === "fused") st.gps.compassActive = true;
    K.Map.updateHeadingVisualOnly();
  }

  function onFusedLocationError(err) {
    const st = K.state;
    st.gps.status = err && err.code === 1 ? "denied" : "idle";
    st.gps.error = err && err.code === 1
      ? "تم رفض إذن الموقع — فعّله من إعدادات المتصفح"
      : "جاري التقاط إشارة GPS...";
    K.UI.updateGpsStatusDOM();
  }

  function recalibrateGps() {
    const st = K.state;
    st.gps.hasRealFix = false;
    st.gps.bestCenterAcc = Infinity;
    st.mapFollowMe = true;
    st.simUseRealGps = true;
    K.Location.recalibrate(true);
  }

  function startRealGps() {
    const st = K.state;
    if (st.gps.status === "idle") st.gps.status = "requesting";
    K.UI.updateGpsStatusDOM();
    K.Location.start({
      onLocationUpdate: onFusedLocationUpdate,
      onHeadingUpdate: onFusedHeadingUpdate,
      onError: onFusedLocationError,
    });
  }

  async function requestCameraPerm(silent = false) {
    const st = K.state;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: true }).catch(() => navigator.mediaDevices.getUserMedia({ video: true, audio: false }));
      stream.getTracks().forEach((t) => t.stop());
      st.camera.status = "granted";
      st.camera.error = null;
      if (!silent) K.showToast("تم تفعيل الكاميرا");
    } catch {
      st.camera.status = "denied";
      st.camera.error = "لم يتم منح إذن الكاميرا";
    }
  }

  function handleMapTap(clicked) {
    const st = K.state;
    if (st.gps.anchorCalibrating) {
      const res = K.Location.setAnchorCalibration(clicked.lat, clicked.lng);
      st.gps.anchorCalibrating = false;
      document.body.classList.remove("anchor-calibrating");
      if (!res.ok) K.showToast(res.error);
      else {
        K.SFX.play("win");
        K.showToast(`تم ضبط موقعك (تصحيح ${res.correctedMeters}م)`);
      }
      K.Map.updateLayers();
      K.UI.updateHudOnly();
      return;
    }
    if (st.route === "create") {
      st.gps.userPickedZone = true;
      st.createForm.center = clicked;
      void K.Map.fetchOverpassPOIs(clicked, st.createForm.radius);
      K.Map.updateLayers();
      K.showToast("تم تحريك مركز الزون");
    } else if (st.route === "simulation" && st.engine) {
      if (st.simUseRealGps) {
        st.simUseRealGps = false;
        K.showToast("تحكم يدوي مفعّل — اضغط زر التمركز للرجوع للـ GPS");
      }
      const prev = st.engine.getVisibleStateForPlayer(st.user.id).self.coords;
      if (K.Geo.distanceMeters(prev, clicked) >= 1) {
        applyHeading(computeBearingDeg(prev, clicked), "sim");
      }
      st.gps.coords = clicked;
      K.Map.setSelfLiveCoords(clicked, false);
      dispatchAction("UPDATE_LOC", { coords: clicked });
      K.Map.updateLayers();
      K.UI.updateHudOnly();
    }
  }

  let lastHeartbeatAt = 0;
  function updateHeartbeatFx(vis) {
    const hbEl = document.getElementById("heartbeat-vignette");
    if (!hbEl) return;
    const ds = vis && vis.dangerSense;
    if (!ds || (K.state.route !== "game" && K.state.route !== "simulation")) {
      hbEl.className = "hidden";
      return;
    }
    hbEl.className = ds.level;
    const now = Date.now();
    const interval = ds.level === "critical" ? 900 : 1750;
    if (now - lastHeartbeatAt >= interval) {
      lastHeartbeatAt = now;
      K.SFX.play(ds.level === "critical" ? "heartbeat_crit" : "heartbeat_warm");
    }
  }

  function setPocketMode(active) {
    const st = K.state;
    st.pocketMode = Boolean(active);
    const el = document.getElementById("pocket-overlay");
    if (el) el.classList.toggle("hidden", !st.pocketMode);
    if (st.pocketMode) updatePocketOverlayDOM();
  }

  function updatePocketOverlayDOM() {
    const st = K.state;
    if (!st.pocketMode || !st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const clk = document.getElementById("pocket-clock");
    if (clk) clk.textContent = K.fmtClock(vis.remainingMatchMs);
    const stEl = document.getElementById("pocket-status");
    if (stEl) {
      if (vis.outsideZoneRemainingMs !== null) {
        stEl.className = "pocket-status danger";
        stEl.textContent = `خارج الزون! ادخل خلال ${Math.ceil(vis.outsideZoneRemainingMs / 1000)}ث`;
      } else if (vis.dangerSense) {
        stEl.className = "pocket-status danger";
        stEl.textContent = vis.dangerSense.label;
      } else {
        const dCenter = Math.round(K.Geo.distanceMeters(vis.self.coords, vis.zone.center));
        const margin = Math.round(vis.zone.currentRadiusMeters - dCenter);
        stEl.className = "pocket-status";
        stEl.textContent = `داخل الزون (${Math.max(0, margin)}م للحدود) • الرصد بعد ${K.fmtClock(vis.nextRevealInMs)}`;
      }
    }
  }

  const SESSION_KEY = "kameen_active_session_v5";

  function persistActiveSession() {
    const st = K.state;
    if (!st.engine) return;
    try {
      const snap = st.engine.getSnapshot();
      if (snap.phase === "GAME_OVER") {
        clearSavedSession();
        return;
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        savedAt: Date.now(),
        code: snap.code,
        isSimMode: Boolean(st.isSimMode),
        roleRevealed: Boolean(st.roleRevealed),
        lobby: st.lobby,
        snapshot: snap,
      }));
    } catch {}
  }

  function clearSavedSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
  }

  function peekSavedSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.snapshot || obj.snapshot.phase === "GAME_OVER") return null;
      if (Date.now() - (obj.savedAt || 0) > 45 * 60000) {
        clearSavedSession();
        return null;
      }
      return obj;
    } catch {
      return null;
    }
  }

  function navigate(nextRoute) {
    stopInAppCamera();
    if (nextRoute !== "game" && nextRoute !== "simulation") setPocketMode(false);
    const st = K.state;
    const prevRoute = st.route;
    if (prevRoute !== nextRoute && st.modal && st.modal !== "eliminated") {
      st.modal = null;
      st.videoAnalyzing = false;
      st.videoVerdict = null;
    }
    st.route = nextRoute;
    const isMap = nextRoute === "create" || nextRoute === "game" || nextRoute === "simulation";
    document.getElementById("app-shell").classList.toggle("hidden", isMap);
    document.getElementById("map-screen").classList.toggle("hidden", !isMap);

    if (nextRoute === "game" || nextRoute === "simulation") {
      void K.WakeLock.acquire();
    } else {
      updateHeartbeatFx(null);
      if (nextRoute === "landing" || nextRoute === "result") {
        K.WakeLock.release();
        K.setDangerVignette(false);
      }
    }

    if (isMap) {
      K.Location.boostLock(true);
      const c = nextRoute === "create"
        ? st.createForm.center
        : (st.engine ? st.engine.getVisibleStateForPlayer(st.user.id).self.coords : st.gps.coords);
      st.mapFollowMe = true;
      K.Map.initPersistentMap(c, true);
      K.Map.updateLayers();
      K.UI.updateHudOnly();
    } else {
      K.UI.renderPage();
    }
    K.UI.renderModal();
  }

  function dispatchAction(actionType, data = {}) {
    const st = K.state;
    if (!st.engine) return;
    if (isMatchHost()) {
      void handleAuthoritativeAction(st.user.id, actionType, data, false);
    } else {
      K.Network.sendRaw("ACTION_REQ", { playerId: st.user.id, type: actionType, data });
    }
  }

  async function handleAuthoritativeAction(playerId, type, data, fromRemote) {
    const st = K.state;
    if (!st.engine) return;
    const t = st.simTimeMs;
    let res = { ok: false, error: "أمر غير معروف" };

    switch (type) {
      case "UPDATE_LOC":
        res = st.engine.updatePlayerLocation(playerId, data.coords, t);
        break;
      case "KILL":
        res = st.engine.attemptKill(playerId, data.targetId, t);
        if (res.ok) { K.SFX.play("kill"); K.triggerShake(); }
        break;
      case "REPORT":
        res = st.engine.reportBody(playerId, data.bodyId, t);
        if (res.ok) { K.SFX.play("alarm"); K.triggerShake(); }
        break;
      case "VOTE":
        res = st.engine.castVote(playerId, data.targetId, t);
        break;
      case "CHAT":
        res = st.engine.sendMeetingChat(playerId, data.text, t);
        break;
      case "LIVE_CHAT":
        res = st.engine.sendLiveChat(playerId, data.text, t);
        break;
      case "POST_CHAT":
        res = st.engine.sendPostChat(playerId, data.text, t);
        break;
      case "SPOKEN":
        res = st.engine.submitSpokenName(playerId, data.accusedId, t);
        if (res.ok && res.data?.caught) K.SFX.play("win");
        break;
      case "BROKER":
        res = st.engine.acceptBrokerOffer(playerId, data.choice || "intel", t);
        if (res.ok) K.SFX.play("broker");
        break;
      case "CLAIM_AIRDROP":
        res = st.engine.claimAirdrop(playerId, t);
        if (res.ok) K.SFX.play("airdrop");
        break;
      case "STEALTH":
        res = st.engine.activateStealth(playerId, t);
        break;
      case "PROTECT":
        res = st.engine.activateProtection(playerId, t);
        break;
      case "BLOODHOUND":
        res = st.engine.activateBloodhound(playerId);
        break;
      case "DECOY":
        res = st.engine.activateDecoy(playerId, t);
        break;
      case "PLANT_RUMOR":
        res = st.engine.activatePlantRumor(playerId, t);
        break;
      case "JAMMER":
        res = st.engine.activateJammer(playerId, t);
        if (res.ok) K.SFX.play("alarm");
        break;
      case "LOC_Q":
        res = st.engine.requestLocationQuestion(playerId, data.placeId);
        break;
      case "BOLD_HINT":
        res = st.engine.requestBoldHint(playerId);
        if (res.ok && res.meta) {
          const aiHint = await K.AI.callGroqChat(
            "أنت المحلل الخاص في لعبة كمين. اكتب جملة واحدة دقيقة ومشوقة بالعامية المصرية بدون ذكر أسماء لاعبين.",
            `اكتب تلميح سري خاص يقول إن الغدّار موجود ${res.meta.place} على بُعد حوالي ${res.meta.dist} متر ناحية الـ${res.meta.dir}.`
          );
          if (aiHint) {
            res.intelText = aiHint;
            if (res.intelId) st.engine.updatePrivateIntel(playerId, res.intelId, aiHint, "groq");
          }
        }
        break;
      case "PRIVATE_PROFILE":
        res = st.engine.requestPrivateProfile(playerId, t);
        if (res.ok && res.meta) {
          const aiProf = await K.AI.callGroqChat(
            "أنت المحلل السلوكي الخاص في لعبة كمين. اكتب تحليل استنتاجي ذكي ودقيق في جملتين قصار بالعامية المصرية بدون أسماء لاعبين.",
            `اكتب تحليل خاص عن سلوك مريب رصدناه ${res.meta.place} على بُعد ${res.meta.dist}م ناحية الـ${res.meta.dir}، الملاحظة السلوكية الحقيقية: ${res.meta.behaviorClue}.`
          );
          if (aiProf) {
            res.intelText = aiProf;
            if (res.intelId) st.engine.updatePrivateIntel(playerId, res.intelId, aiProf, "groq");
          }
        }
        break;
      case "IMP_INTEL":
        res = st.engine.requestImposterIntel(playerId, t);
        if (res.ok && res.meta) {
          const aiImp = await K.AI.callGroqChat(
            "أنت المحلل السري للغدّار في لعبة كمين. رد بجملة تكتيكية قصيرة بالعامية المصرية.",
            `بلغ الغدّار إن أسهل محقق معزول هو ${res.meta.targetName} وموجود ${res.meta.isoPlace} على بعد ${res.meta.isoDist}م ناحية الـ${res.meta.isoDir} ${res.meta.nextStop}.`
          );
          if (aiImp) {
            res.intelText = aiImp;
            if (res.intelId) st.engine.updatePrivateIntel(playerId, res.intelId, aiImp, "groq");
          }
        }
        break;
      case "MISSION_START":
        res = st.engine.startMission(playerId, data.missionId, t);
        break;
      case "REROLL_MISSION":
        res = st.engine.rerollMission(playerId, data.missionId, t);
        break;
      case "MISSION_COMPLETE":
        res = st.engine.completeMission(playerId, data.missionId, Boolean(data.videoVerified), t, data.aiNote || null);
        if (res.ok) K.SFX.play("win");
        break;
    }

    K.Network.broadcastMatchSnapshot(true);

    if (fromRemote) {
      K.Network.sendRaw("ACTION_RES", {
        playerId, ok: res.ok, error: res.error, toast: res.toast, intelText: res.intelText,
      });
    } else {
      if (!res.ok && res.error) K.showToast(res.error);
      if (res.ok && res.toast) K.showToast(res.toast);
      if (res.intelText) {
        st.lastIntel = res.intelText;
        K.SFX.play("intel");
      }
    }

    const snap = st.engine.getSnapshot();
    if (checkMatchTransitions(null, snap)) return;

    if (st.route === "game" || st.route === "simulation") {
      K.Map.updateLayers();
      K.UI.updateHudOnly();
      if (st.modal === "live_chat") K.UI.updateLiveChatDynamic();
      else if (st.modal === "intel_log" && type !== "UPDATE_LOC") K.UI.renderModal();
    } else if (st.route === "meeting") {
      K.UI.updateMeetingDynamic();
    } else if (st.route === "result") {
      K.UI.updateResultChatDOM();
    }
  }

  function recordGameStats(snap) {
    const st = K.state;
    if (st.recordedGameOverId === snap.matchId) return;
    st.recordedGameOverId = snap.matchId;
    const me = snap.players[st.user.id];
    if (!me || me.isSpectator) return;
    const won = (snap.winner === "INVESTIGATORS" && me.role === "INVESTIGATOR") ||
                (snap.winner === "IMPOSTERS" && me.role === "IMPOSTER");
    st.user.matchesPlayed += 1;
    if (won) st.user.matchesWon += 1;
    st.user.missionsCompleted += me.missionsCompleted || 0;
    st.user.kills = (st.user.kills || 0) + (me.killsCount || 0);
    K.saveStats({
      played: st.user.matchesPlayed,
      won: st.user.matchesWon,
      missions: st.user.missionsCompleted,
      kills: st.user.kills,
    });
  }

  function checkMatchTransitions(prevPhase, snap) {
    const st = K.state;

    if (snap.lastPingSweepAtMs && snap.lastPingSweepAtMs !== st.lastPingSweepNotified) {
      st.lastPingSweepNotified = snap.lastPingSweepAtMs;
      K.SFX.play("radar");
      K.showToast("تم تحديث قراءة الرادار لجميع اللاعبين");
    }

    if (snap.activeBrokerOffer && snap.activeBrokerOffer.id !== st.lastBrokerIdNotified) {
      st.lastBrokerIdNotified = snap.activeBrokerOffer.id;
      K.SFX.play("broker");
      K.showToast("صفقة سمسار سرية متاحة الآن");
    }

    if (snap.activeAirdrop && snap.activeAirdrop.id !== st.lastAirdropIdNotified) {
      st.lastAirdropIdNotified = snap.activeAirdrop.id;
      K.SFX.play("airdrop");
      K.showToast(`إمداد نزل ${snap.activeAirdrop.place}`);
    }

    if (snap.liveChat && snap.liveChat.length > 0) {
      const lastMsg = snap.liveChat[snap.liveChat.length - 1];
      if (lastMsg.id !== st.lastLiveChatSeenId) {
        st.lastLiveChatSeenId = lastMsg.id;
        if (lastMsg.senderId !== st.user.id && st.modal !== "live_chat") {
          st.lastChatBanner = { sender: lastMsg.senderName, text: lastMsg.text, atMs: Date.now() };
          K.SFX.play("click");
        }
        if (st.modal === "live_chat") K.UI.updateLiveChatDynamic();
      }
    }

    if (snap.aiReports && snap.aiReports.length > 0) {
      const latest = snap.aiReports[snap.aiReports.length - 1];
      const formatted = `المحلل: ${latest.summaryText}`;
      if (st.lastIntel !== formatted && Date.now() - latest.createdAtMs < 6000) {
        st.lastIntel = formatted;
        K.SFX.play("intel");
      }
    }

    const me = snap.players[st.user.id];
    if (me && !me.alive && !me.isSpectator && !st.eliminatedAck && snap.phase !== "GAME_OVER") {
      st.eliminatedAck = true;
      K.SFX.play("kill");
      K.triggerShake();
      st.modal = "eliminated";
      K.UI.renderModal();
    }

    if (snap.phase === "MEETING" && prevPhase !== "MEETING") {
      K.SFX.play("alarm");
      K.triggerShake();
    }

    if (snap.phase === "MEETING" && (st.route === "game" || st.route === "simulation")) {
      navigate("meeting");
      return true;
    }
    if (snap.phase === "ACTIVE" && st.route === "meeting") {
      navigate(st.isSimMode ? "simulation" : "game");
      return true;
    }
    if (snap.phase === "GAME_OVER" && st.route !== "result") {
      clearSavedSession();
      recordGameStats(snap);
      K.SFX.play("win");
      navigate("result");
      void K.AI.generateMatchRecap(snap);
      return true;
    }
    return false;
  }

  function applyRemoteSnapshot(snap) {
    const st = K.state;
    const prevPhase = st.engine ? st.engine.getSnapshot().phase : null;
    st.engine = K.KameenEngine.fromSnapshot(snap);
    st.simTimeMs = snap.nowMs;
    if (checkMatchTransitions(prevPhase, snap)) return;
    if (st.route === "game" || st.route === "simulation") {
      K.Map.updateLayers();
      K.UI.updateHudOnly();
      if (st.modal === "live_chat") K.UI.updateLiveChatDynamic();
    } else if (st.route === "meeting") {
      K.UI.updateMeetingDynamic();
    } else if (st.route === "result") {
      K.UI.updateResultChatDOM();
    }
  }

  function startEngineLoop() {
    const st = K.state;
    if (st.tickTimer) clearInterval(st.tickTimer);
    st.tickTimer = setInterval(() => {
      if (!st.engine) return;
      if (st.isSimMode && !st.simRunning) return;

      if (isMatchHost()) {
        const prevPhase = st.engine.getSnapshot().phase;
        const stepMs = st.isSimMode ? 1000 * st.simSpeed : 1000;
        st.simTimeMs = st.isSimMode ? st.simTimeMs + stepMs : Date.now();
        st.engine.tick(st.simTimeMs);
        K.stepBots(st.engine, st.isSimMode ? 1.6 * st.simSpeed : 1.6);
        void K.AI.triggerProfilerReport(false);
        K.Network.broadcastMatchSnapshot(false);

        const snap = st.engine.getSnapshot();
        if (checkMatchTransitions(prevPhase, snap)) return;
      }

      if (st.engine && (st.simTimeMs % 3000 < 1000)) persistActiveSession();
      if (st.route === "game" || st.route === "simulation") {
        const visNow = st.engine.getVisibleStateForPlayer(st.user.id);
        updateHeartbeatFx(visNow);
        if (st.pocketMode) updatePocketOverlayDOM();
        else {
          K.Map.updateLayers();
          K.UI.updateHudOnly();
          if (st.modal === "missions_sheet") K.UI.updateMissionsDynamic();
          if (st.modal === "live_chat") K.UI.updateLiveChatDynamic();
        }
      } else if (st.route === "meeting") {
        K.UI.updateMeetingDynamic();
      }
    }, 1000);
  }

  function joinLobbyByCode(rawCode) {
    const st = K.state;
    const code = (rawCode || "").trim().toUpperCase();
    if (code.length < 4) return K.showToast("اكتب كود المنطقة أولاً (مثال KMN402)");
    K.SFX.play("click");

    const localRaw = localStorage.getItem("kameen_lobby_" + code);
    if (localRaw) {
      const lobby = JSON.parse(localRaw);
      if (!lobby.players.some((p) => p.id === st.user.id)) {
        lobby.players.push({
          id: st.user.id, name: st.user.name || "العميل X",
          isBot: false, isHost: false, isReady: true, isSpectator: false, coords: st.gps.coords,
        });
        try { localStorage.setItem("kameen_lobby_" + code, JSON.stringify(lobby)); } catch {}
      }
      st.lobby = lobby;
      K.Network.connectRoomChannel(code);
      navigate("lobby");
      return;
    }

    K.showToast("جاري البحث عن الغرفة " + code + "...");
    K.Network.connectRoomChannel(code, () => {
      const sendJoin = () => {
        K.Network.sendRaw("JOIN_REQ", {
          player: { id: st.user.id, name: st.user.name || "العميل X", isSpectator: false, coords: st.gps.coords },
        });
      };
      sendJoin();
      let tries = 0;
      const retryIv = setInterval(() => {
        tries += 1;
        if (st.lobby && st.lobby.code === code) { clearInterval(retryIv); return; }
        if (tries >= 4) { clearInterval(retryIv); return; }
        sendJoin();
      }, 1500);
      st.joinTimeout = setTimeout(() => {
        clearInterval(retryIv);
        if (!st.lobby || st.lobby.code !== code) {
          K.showToast("لم يتم العثور على غرفة بهذا الكود");
        }
      }, 7500);
    });
  }

  // =========================================================================
  // GLOBAL EVENT HANDLERS
  // =========================================================================
  window.onGrantAllPermissionsAndEnter = async () => {
    K.SFX.warmup();
    K.SFX.play("click");
    startRealGps();
    await startCompass(true);
    K.Location.boostLock(true);
    void requestCameraPerm(true);
    try { localStorage.setItem("kameen_perms_v4", "1"); } catch {}
    K.showToast("تم تفعيل الموقع والبوصلة والحساسات تلقائياً");
    navigate("landing");
  };

  window.onSkipPermissionsGate = () => {
    K.SFX.warmup();
    startRealGps();
    void startCompass(true);
    try { localStorage.setItem("kameen_perms_v4", "1"); } catch {}
    navigate("landing");
  };

  window.onNav = (route) => { K.SFX.play("click"); navigate(route); };
  window.onOpenModal = (name) => { if (name !== "camera") stopInAppCamera(); K.SFX.play("click"); K.state.modal = name; K.UI.renderModal(); };
  window.onCloseModal = () => {
    stopInAppCamera();
    K.state.modal = null;
    K.UI.renderModal();
    if (K.state.route === "game" || K.state.route === "simulation") K.UI.updateHudOnly();
  };

  // Unified Settings updater (works on Home, Create Zone, Lobby with real-time sync, AND Live Match!)
  window.onUpdateGameSetting = (field, val) => {
    const st = K.state;
    K.SFX.play("click");
    st.createForm[field] = val;
    if (st.lobby && st.lobby.hostId === st.user.id) {
      st.lobby[field] = val;
      K.Network.broadcastLobbyState();
      if (st.route === "lobby") K.UI.renderPage();
    }
    if (st.engine && isMatchHost() && (field === "revealIntervalSec" || field === "revealMode")) {
      st.engine.updateLiveSettings({ [field]: val });
      K.Network.broadcastMatchSnapshot(true);
      if (st.route === "game" || st.route === "simulation") K.UI.updateHudOnly();
    }
    if (st.route === "create") K.UI.updateHudOnly();
    K.UI.renderModal();
  };

  window.onToggleLobbySpectator = () => {
    const st = K.state;
    if (!st.lobby) return;
    K.SFX.play("click");
    const me = st.lobby.players.find((p) => p.id === st.user.id);
    if (!me) return;
    const nextSpec = !me.isSpectator;
    if (st.lobby.hostId === st.user.id) {
      me.isSpectator = nextSpec;
      K.Network.broadcastLobbyState();
      K.UI.renderPage();
    } else {
      me.isSpectator = nextSpec;
      K.Network.sendRaw("SPECTATOR_REQ", { playerId: st.user.id, isSpectator: nextSpec });
      K.UI.renderPage();
    }
  };

  window.onStartCreateFlow = () => {
    K.SFX.warmup();
    K.SFX.play("click");
    startRealGps();
    K.Location.boostLock(true);
    void K.Map.fetchOverpassPOIs(K.state.createForm.center, K.state.createForm.radius);
    navigate("create");
  };

  window.onUseMyLocationForZone = () => {
    startRealGps();
    K.Location.boostLock(true);
    K.state.createForm.center = { ...K.state.gps.coords };
    K.Map.recenter();
    void K.Map.fetchOverpassPOIs(K.state.createForm.center, K.state.createForm.radius);
    K.Map.updateLayers();
    K.showToast("تم ضبط الزون على موقعك الحالي");
  };

  window.onRadiusSlide = (val) => {
    K.state.createForm.radius = Number(val);
    K.Map.updateLayers();
    const lbl = document.getElementById("create-radius-lbl");
    if (lbl) {
      const sec = K.state.createForm.revealIntervalSec;
      const rTxt = sec < 60 ? `${sec} ثانية` : (sec === 60 ? "دقيقة" : (sec === 120 ? "دقيقتين" : `${Math.round(sec / 60)} دقائق`));
      lbl.innerHTML = `نصف القطر <span style="color:var(--crimson);" class="tnum">${val}م</span> • رصد كل ${rTxt}`;
    }
  };

  window.onCreateMatch = () => {
    const st = K.state;
    K.SFX.play("click");
    const code = "KMN" + Math.floor(100 + Math.random() * 899);
    const matchId = "match-" + Date.now();
    const pois = st.createForm.pois.length >= 3
      ? st.createForm.pois
      : K.Geo.generateFallbackPOIs(st.createForm.center, st.createForm.radius);
    st.lobby = {
      matchId, code,
      title: st.createForm.title || "كمين الشلة",
      hostId: st.user.id,
      center: st.createForm.center,
      radius: st.createForm.radius,
      duration: st.createForm.duration,
      spreadSeconds: st.createForm.spreadSeconds,
      imposters: st.createForm.imposters,
      revealIntervalSec: st.createForm.revealIntervalSec,
      revealMode: st.createForm.revealMode,
      pois,
      players: [{
        id: st.user.id, name: st.user.name || "العميل X",
        isBot: false, isHost: true, isReady: true, isSpectator: false, coords: st.gps.coords,
      }],
      started: false,
    };
    K.Network.connectRoomChannel(code, () => {
      K.Network.broadcastLobbyState();
      K.showToast(`الغرفة جاهزة • الكود ${code}`);
    });
    navigate("lobby");
  };

  window.onJoinByInput = () => {
    K.SFX.warmup();
    startRealGps();
    K.Location.boostLock(true);
    const inp = document.getElementById("join-code-input");
    joinLobbyByCode(inp ? inp.value : K.state.joinCode);
  };

  window.onLeaveLobby = () => {
    if (K.state.lobby && K.state.lobby.hostId !== K.state.user.id) {
      K.Network.sendRaw("LEAVE_REQ", { playerId: K.state.user.id });
    }
    K.Network.disconnectRoomChannel();
    K.state.lobby = null;
    navigate("landing");
  };

  window.onCopyInviteCode = () => {
    if (!K.state.lobby) return;
    navigator.clipboard?.writeText(K.state.lobby.code);
    K.showToast("تم نسخ كود الغرفة");
  };

  window.onShareWhatsApp = () => {
    if (!K.state.lobby) return;
    const baseUrl = window.location.origin + window.location.pathname;
    const inviteUrl = `${baseUrl}?join=${K.state.lobby.code}`;
    const msg = `انضم لغرفة كمين الآن!\nكود المنطقة: ${K.state.lobby.code}\n${inviteUrl}`;
    if (navigator.share) {
      navigator.share({ title: "دعوة لعبة كمين", text: msg }).catch(() => {});
    } else {
      window.open("https://wa.me/?text=" + encodeURIComponent(msg), "_blank");
    }
  };

  window.onAddBotToLobby = () => {
    const st = K.state;
    if (!st.lobby) return;
    K.SFX.play("click");
    const idx = st.lobby.players.filter((p) => p.isBot).length;
    const angle = (idx / 8) * Math.PI * 2;
    st.lobby.players.push({
      id: "bot-" + Date.now() + "-" + idx,
      name: K.BOT_NAMES[idx % K.BOT_NAMES.length],
      isBot: true, isHost: false, isReady: true, isSpectator: false,
      coords: K.Geo.offsetCoordinates(st.lobby.center, Math.cos(angle) * 20, Math.sin(angle) * 20),
    });
    K.Network.broadcastLobbyState();
    K.UI.renderPage();
  };

  window.onKickLobbyPlayer = (pid) => {
    if (!K.state.lobby || K.state.lobby.hostId !== K.state.user.id) return;
    K.state.lobby.players = K.state.lobby.players.filter((p) => p.id !== pid);
    K.Network.broadcastLobbyState();
    K.UI.renderPage();
  };

  window.onStartMatchFromLobby = () => {
    const st = K.state;
    if (!st.lobby) return;
    const activeCount = st.lobby.players.filter((p) => !p.isSpectator).length;
    if (activeCount < 3) return K.showToast("مطلوب 3 لاعبين على الأقل لبدء الجيم");
    K.SFX.play("alarm");
    const t0 = Date.now();
    st.isSimMode = false;
    const hostEntry = st.lobby.players.find((p) => p.id === st.user.id);
    if (hostEntry && st.gps.hasRealFix) hostEntry.coords = { ...st.gps.coords };
    st.engine = new K.KameenEngine({
      matchId: st.lobby.matchId, code: st.lobby.code, hostId: st.lobby.hostId,
      title: st.lobby.title, zoneCenter: st.lobby.center, zoneRadiusMeters: st.lobby.radius,
      durationMinutes: st.lobby.duration, spreadSeconds: st.lobby.spreadSeconds ?? 60,
      imposterCount: st.lobby.imposters,
      revealIntervalSec: st.lobby.revealIntervalSec || 120,
      revealMode: st.lobby.revealMode || "ping",
      pois: st.lobby.pois, seed: t0,
    }, st.lobby.players, t0);
    st.simTimeMs = t0;
    st.lobby.started = true;
    st.roleRevealed = false; st.roleFlipped = false; st.eliminatedAck = false;
    st.lastIntel = null; st.lastReadLiveChatCount = 0; st.lastLiveChatSeenId = null; st.lastChatBanner = null; st.lastBrokerIdNotified = null; st.lastAirdropIdNotified = null; st.lastPingSweepNotified = 0;
    K.Network.broadcastLobbyState();
    K.Network.broadcastMatchSnapshot(true);
    startEngineLoop();
    navigate("game");
  };

  window.onStartSimulation = () => {
    const st = K.state;
    K.SFX.warmup();
    K.SFX.play("click");
    K.Location.boostLock(true);
    K.Network.disconnectRoomChannel();
    const t0 = Date.now();
    const center = { ...st.gps.coords };
    const bots = [
      { id: st.user.id, name: st.user.name || "العميل X", isBot: false, isHost: true, isReady: true, isSpectator: false, coords: { ...center } },
      ...K.BOT_NAMES.slice(0, 6).map((n, i) => ({
        id: "sim-bot-" + i, name: n, isBot: true, isHost: false, isReady: true, isSpectator: false,
        coords: K.Geo.offsetCoordinates(center, Math.cos(i) * 32, Math.sin(i) * 32),
      })),
    ];
    st.isSimMode = true; st.simUseRealGps = true; st.simSpeed = 1; st.simRunning = true; st.simDpadVisible = false;
    st.simTimeMs = t0;
    const initialPois = (st.createForm.pois && st.createForm.pois.length >= 2)
      ? st.createForm.pois : K.Geo.generateFallbackPOIs(center, 220);
    st.engine = new K.KameenEngine({
      matchId: "sim-lab-" + t0, code: "SIM001", hostId: st.user.id, title: "تجربة فردية",
      zoneCenter: center, zoneRadiusMeters: 220, durationMinutes: st.createForm.duration || 15,
      spreadSeconds: 20, imposterCount: 1,
      revealIntervalSec: st.createForm.revealIntervalSec || 120,
      revealMode: st.createForm.revealMode || "ping",
      pois: initialPois, seed: t0,
    }, bots, t0);
    void K.Map.fetchOverpassPOIs(center, 220, true);
    st.roleRevealed = false; st.roleFlipped = false; st.eliminatedAck = false;
    st.lastIntel = null; st.lastReadLiveChatCount = 0; st.lastLiveChatSeenId = null; st.lastChatBanner = null; st.lastBrokerIdNotified = null; st.lastAirdropIdNotified = null; st.lastPingSweepNotified = 0;
    startEngineLoop();
    navigate("simulation");
  };

  window.onFlipRoleCard = () => { K.SFX.play("intel"); K.state.roleFlipped = true; K.UI.renderModal(); };
  window.onAcceptRoleCard = () => { K.SFX.play("click"); K.state.roleRevealed = true; K.UI.renderModal(); };
  window.onKillTarget = (targetId) => dispatchAction("KILL", { targetId });
  window.onReportBody = (bodyId) => dispatchAction("REPORT", { bodyId });
  window.onCastVote = (targetId) => dispatchAction("VOTE", { targetId });
  window.onClaimAirdrop = () => dispatchAction("CLAIM_AIRDROP");
  window.onAcceptBroker = (choice) => {
    K.state.modal = choice === "intel" ? "intel_log" : null;
    if (choice === "intel") K.state.intelTab = "private";
    K.UI.renderModal();
    dispatchAction("BROKER", { choice });
  };
  window.onUseAbility = (type) => {
    const isPrivateIntel = type === "BOLD_HINT" || type === "BLOODHOUND" || type === "PRIVATE_PROFILE" || type === "IMP_INTEL";
    if (isPrivateIntel) {
      K.state.intelTab = "private";
      K.state.modal = "intel_log";
    } else {
      K.state.modal = null;
    }
    K.UI.renderModal();
    dispatchAction(type);
  };
  window.onScanPlace = (placeId) => {
    K.state.intelTab = "private";
    K.state.privateScanOpen = false;
    K.state.modal = "intel_log";
    K.UI.renderModal();
    dispatchAction("LOC_Q", { placeId });
  };
  window.onSwitchIntelTab = (tab) => {
    K.SFX.play("click");
    K.state.intelTab = tab === "private" ? "private" : "public";
    K.state.privateScanOpen = false;
    K.UI.renderModal();
  };
  window.onSwitchMeetingIntelTab = (tab) => {
    K.SFX.play("click");
    K.state.meetingIntelTab = tab === "private" ? "private" : "public";
    K.UI.renderPage();
  };
  window.onTogglePrivateScanBox = () => {
    K.SFX.play("click");
    K.state.privateScanOpen = !K.state.privateScanOpen;
    K.UI.renderModal();
  };
  window.onBuyPrivateIntel = (type) => {
    K.SFX.play("click");
    K.state.intelTab = "private";
    K.state.privateScanOpen = false;
    dispatchAction(type);
  };
  window.onBuyPrivateScan = (placeId) => {
    K.SFX.play("click");
    K.state.intelTab = "private";
    K.state.privateScanOpen = false;
    dispatchAction("LOC_Q", { placeId });
  };
  window.onSpokenName = (accusedId) => { K.state.modal = null; K.UI.renderModal(); dispatchAction("SPOKEN", { accusedId }); };
  window.onStartMission = (missionId) => { K.state.modal = null; K.UI.renderModal(); dispatchAction("MISSION_START", { missionId }); };
  window.onRerollMission = (missionId) => {
    dispatchAction("REROLL_MISSION", { missionId });
    if (K.state.modal === "missions_sheet") K.UI.updateMissionsDynamic();
  };

  window.openCameraForMission = (missionId) => {
    K.state.activeCameraMissionId = missionId;
    K.state.videoVerdict = null;
    K.state.videoVerdictTone = "pending";
    K.state.videoAnalyzing = false;
    K.state.modal = "camera";
    K.UI.renderModal();
    setTimeout(() => void startInAppCamera(missionId), 40);
  };

  window.onOpenLiveChat = () => {
    stopInAppCamera();
    K.SFX.play("click");
    K.state.lastChatBanner = null;
    if (K.state.engine) {
      const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
      K.state.lastReadLiveChatCount = (vis.liveChat || []).length;
    }
    K.state.modal = "live_chat";
    K.UI.renderModal();
    K.UI.updateHudOnly();
  };

  window.onSendLiveChat = () => {
    const inp = document.getElementById("live-chat-input");
    if (!inp) return;
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = "";
    dispatchAction("LIVE_CHAT", { text: txt });
  };

  window.onQuickLiveChat = (txt) => {
    K.SFX.play("click");
    dispatchAction("LIVE_CHAT", { text: txt });
  };

  window.onSendMeetingChat = () => {
    const inp = document.getElementById("meeting-chat-input");
    if (!inp) return;
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = "";
    dispatchAction("CHAT", { text: txt });
  };
  window.onQuickMeetingChat = (txt) => dispatchAction("CHAT", { text: txt });

  window.onSendPostChat = () => {
    const inp = document.getElementById("post-chat-inp");
    if (!inp) return;
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = "";
    dispatchAction("POST_CHAT", { text: txt });
  };

  window.cycleSimSpeed = () => {
    K.state.simSpeed = K.state.simSpeed === 5 ? 1 : K.state.simSpeed === 2 ? 5 : 2;
    K.UI.updateHudOnly();
  };
  window.onToggleSimDpad = () => {
    K.state.simDpadVisible = !K.state.simDpadVisible;
    K.UI.updateHudOnly();
  };
  window.onSimNudge = (dNorth, dEast) => {
    if (!K.state.engine) return;
    K.state.simUseRealGps = false;
    const cur = K.state.engine.getVisibleStateForPlayer(K.state.user.id).self.coords;
    const next = K.Geo.offsetCoordinates(cur, dNorth, dEast);
    applyHeading(computeBearingDeg(cur, next), "sim");
    K.state.gps.coords = next;
    K.Map.setSelfLiveCoords(next, false);
    dispatchAction("UPDATE_LOC", { coords: next });
  };
  window.onSimToggleRole = () => {
    if (!K.state.engine) return;
    const r = K.state.engine.simTogglePlayerRole(K.state.user.id);
    if (r.ok) {
      K.SFX.play("intel");
      K.showToast(r.role === "IMPOSTER" ? "تم التبديل إلى دور الغدّار" : "تم التبديل إلى دور المحقق");
      K.UI.updateHudOnly();
    }
  };
  window.onSimSkipSpread = () => { K.state.engine?.skipSpread(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };
  window.onSimForceAI = () => { K.showToast("جاري تحليل التحركات..."); void K.AI.triggerProfilerReport(true); };
  window.onSimSpawnAirdrop = () => { K.state.engine?.spawnAirdrop(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };
  window.onSimTriggerBroker = () => { K.state.engine?.triggerBrokerOffer(4, K.state.simTimeMs); K.UI.updateHudOnly(); };
  window.onSimShrinkZone = () => { K.state.engine?.shrinkZone(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };
  window.onSimRadar = () => { K.state.engine?.triggerLocationReveal(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };

  window.exitGameToLanding = () => {
    clearSavedSession();
    if (K.state.tickTimer) clearInterval(K.state.tickTimer);
    K.Network.disconnectRoomChannel();
    K.WakeLock.release();
    K.setDangerVignette(false);
    updateHeartbeatFx(null);
    K.state.isSimMode = false; K.state.engine = null; K.state.lobby = null; K.state.modal = null;
    navigate("landing");
  };

  window.exitGameToCreate = () => {
    clearSavedSession();
    if (K.state.tickTimer) clearInterval(K.state.tickTimer);
    K.Network.disconnectRoomChannel();
    K.WakeLock.release();
    K.setDangerVignette(false);
    updateHeartbeatFx(null);
    K.state.isSimMode = false; K.state.engine = null; K.state.lobby = null; K.state.modal = null;
    navigate("create");
  };

  window.onStartAnchorCalibration = () => {
    const st = K.state;
    if (!st.gps.hasRealFix) return K.showToast("استنى الـ GPS يلقط موقعك أولاً");
    st.modal = null;
    st.gps.anchorCalibrating = true;
    st.simUseRealGps = true;
    document.body.classList.add("anchor-calibrating");
    K.UI.renderModal();
    K.UI.updateHudOnly();
  };
  window.onCancelAnchorCalibration = () => {
    K.state.gps.anchorCalibrating = false;
    document.body.classList.remove("anchor-calibrating");
    K.UI.updateHudOnly();
  };
  window.onClearAnchorCalibration = () => {
    K.Location.clearAnchorCalibration();
    K.Map.updateLayers();
    K.showToast("تم إلغاء التعديل اليدوي");
  };

  window.onTestGroqConnection = async () => {
    const out = document.getElementById("groq-test-result");
    if (out) {
      out.classList.remove("hidden");
      out.style.color = "#FCD34D";
      out.textContent = "جاري فحص الاتصال بسيرفر Groq...";
    }
    const res = await K.AI.testConnection();
    if (out) {
      out.classList.remove("hidden");
      out.style.color = res.ok ? "#34D399" : "#FF6B7D";
      out.textContent = res.message;
    }
    K.showToast(res.ok ? "سيرفر الذكاء الاصطناعي متصل وشغال!" : "فشل فحص الاتصال — شوف السبب في الإعدادات");
  };

  window.onResetDefaultGroqKey = () => {
    const defKey = K.CONFIG.DEFAULT_GROQ_KEY || "";
    K.state.groqKey = defKey;
    try { localStorage.removeItem("kameen_groq_key"); } catch {}
    K.UI.renderModal();
    K.showToast("تمت استعادة المفتاح المدمج");
  };

  window.addEventListener("resize", () => K.Map.resize());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (K.state.route === "game" || K.state.route === "simulation")) {
      void K.WakeLock.acquire();
    }
  });


  // =========================================================================
  // IN-APP LIVE CAMERA & VIDEO/AUDIO RECORDER (NEVER LEAVES THE BROWSER!)
  // =========================================================================
  const camCtrl = {
    stream: null,
    recorder: null,
    chunks: [],
    capturedFrames: [],
    capturedMaxLum: 0,
    recTimer: null,
    frameTimer: null,
    startedAtMs: 0,
    wantsAudio: false,
    recordingMissionId: null,
  };

  function grabLiveVideoFrame() {
    const video = document.getElementById("inapp-cam-video");
    if (!video || !video.videoWidth || !video.videoHeight) return null;
    const c = document.createElement("canvas");
    const maxW = 448;
    const ratio = Math.min(1, maxW / video.videoWidth);
    c.width = Math.max(220, Math.round(video.videoWidth * ratio));
    c.height = Math.max(165, Math.round(video.videoHeight * ratio));
    const ctx = c.getContext("2d");
    ctx.drawImage(video, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lum = 0;
    for (let i = 0; i < data.length; i += 24) lum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    const avgLum = lum / Math.max(1, data.length / 24);
    const b64 = c.toDataURL("image/jpeg", 0.74).split(",")[1];
    return { b64, avgLum };
  }

  function stopInAppCamera() {
    if (camCtrl.recTimer) { clearInterval(camCtrl.recTimer); camCtrl.recTimer = null; }
    if (camCtrl.frameTimer) { clearInterval(camCtrl.frameTimer); camCtrl.frameTimer = null; }
    if (camCtrl.recorder && camCtrl.recorder.state !== "inactive") {
      try { camCtrl.recorder.onstop = null; camCtrl.recorder.stop(); } catch {}
    }
    camCtrl.recorder = null;
    camCtrl.chunks = [];
    if (camCtrl.stream) {
      try { camCtrl.stream.getTracks().forEach((t) => t.stop()); } catch {}
      camCtrl.stream = null;
    }
    const video = document.getElementById("inapp-cam-video");
    if (video) {
      try { video.srcObject = null; } catch {}
    }
    K.state.camera.ready = false;
    K.state.camera.recording = false;
    K.state.camera.recSec = 0;
  }

  async function startInAppCamera(missionId) {
    stopInAppCamera();
    const st = K.state;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      st.camera.status = "denied";
      st.camera.error = "المتصفح مش بيدعم الكاميرا المباشرة — استخدم زر رفع ملف من تحت.";
      K.UI.updateCameraModalStatus();
      return;
    }

    const vis = st.engine ? st.engine.getVisibleStateForPlayer(st.user.id) : null;
    const mission = vis ? (vis.missions || []).find((m) => m.id === missionId) : null;
    const wantsAudio = Boolean(mission && mission.requiresSpeech && mission.requiresSpeech.length);
    camCtrl.wantsAudio = wantsAudio;
    st.camera.status = "starting";
    st.camera.error = null;
    st.camera.ready = false;
    K.UI.updateCameraModalStatus();

    const facing = st.camera.facingMode || "environment";
    const attempts = [
      { video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: wantsAudio },
      { video: { facingMode: facing }, audio: wantsAudio },
      { video: true, audio: wantsAudio },
      { video: true, audio: false },
    ];

    let stream = null;
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!stream) {
      st.camera.status = "denied";
      st.camera.error = (lastErr && lastErr.name === "NotAllowedError")
        ? "تم رفض إذن الكاميرا/المايك — فعّله من علامة القفل جنب رابط الموقع فوق."
        : "معرفتش أفتح الكاميرا المباشرة — جرّب تقلب الكاميرا أو استخدم زر رفع ملف من تحت.";
      K.UI.updateCameraModalStatus();
      return;
    }

    // If modal was closed or route changed (e.g. emergency meeting!) while waiting, stop immediately!
    if (st.modal !== "camera" || (st.route !== "game" && st.route !== "simulation")) {
      try { stream.getTracks().forEach((t) => t.stop()); } catch {}
      return;
    }

    camCtrl.stream = stream;
    st.camera.status = "granted";
    st.camera.error = null;

    const video = document.getElementById("inapp-cam-video");
    if (video) {
      video.setAttribute("playsinline", "");
      video.setAttribute("muted", "");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await new Promise((resolve) => {
        const done = () => { video.onloadedmetadata = null; resolve(); };
        if (video.readyState >= 1) return resolve();
        video.onloadedmetadata = done;
        setTimeout(done, 1200);
      });
      try { await video.play(); } catch {}
    }

    if (st.modal !== "camera") {
      stopInAppCamera();
      return;
    }

    st.camera.ready = true;
    K.UI.updateCameraModalStatus();
  }

  function flipInAppCamera() {
    K.SFX.play("click");
    K.state.camera.facingMode = K.state.camera.facingMode === "environment" ? "user" : "environment";
    void startInAppCamera(K.state.activeCameraMissionId);
  }

  function takeInAppPhoto() {
    const st = K.state;
    if (st.videoAnalyzing || st.camera.recording) return;
    const snap = grabLiveVideoFrame();
    if (!snap) {
      K.showToast("استنى ثانية الكاميرا تفتح بوضوح");
      return;
    }
    K.SFX.play("click");
    void K.AI.analyzeCapturedSubmission(st.activeCameraMissionId, {
      frames: [snap.b64],
      maxAvgLum: snap.avgLum,
      audioBlob: null,
      isVideo: false,
    });
  }

  function pickBestRecorderOptions(stream, wantsAudio) {
    if (typeof MediaRecorder === "undefined") return null;
    const audioTracks = stream.getAudioTracks();
    // For speech dares, recording ONLY the lightweight audio track (40KB) makes Groq Whisper instant on 4G!
    if (wantsAudio && audioTracks.length > 0) {
      const audioStream = new MediaStream(audioTracks);
      const audioMimes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
      for (const m of audioMimes) {
        try {
          if (MediaRecorder.isTypeSupported(m)) return { targetStream: audioStream, mimeType: m };
        } catch {}
      }
      return { targetStream: audioStream, mimeType: "" };
    }
    // Otherwise try light video recording
    const videoMimes = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    for (const m of videoMimes) {
      try {
        if (MediaRecorder.isTypeSupported(m)) return { targetStream: stream, mimeType: m };
      } catch {}
    }
    return { targetStream: stream, mimeType: "" };
  }

  function finishInAppRecording() {
    const st = K.state;
    if (!st.camera.recording) return;
    st.camera.recording = false;

    if (camCtrl.recTimer) { clearInterval(camCtrl.recTimer); camCtrl.recTimer = null; }
    if (camCtrl.frameTimer) { clearInterval(camCtrl.frameTimer); camCtrl.frameTimer = null; }

    // Grab final closing frame right at stop
    const endSnap = grabLiveVideoFrame();
    if (endSnap) {
      camCtrl.capturedFrames.push(endSnap.b64);
      if (endSnap.avgLum > camCtrl.capturedMaxLum) camCtrl.capturedMaxLum = endSnap.avgLum;
    }

    // Keep up to 3 well-spaced frames (start, middle, end)
    let frames = camCtrl.capturedFrames;
    if (frames.length > 3) {
      frames = [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]];
    }
    const maxLum = camCtrl.capturedMaxLum;
    const mId = camCtrl.recordingMissionId || st.activeCameraMissionId;
    const wantsAudio = camCtrl.wantsAudio;

    K.UI.updateCameraModalStatus();

    const submitNow = (audioBlob) => {
      if (!frames.length) {
        st.videoVerdictTone = "error";
        st.videoVerdict = "معرفتش ألقط صورة من الكاميرا — حاول تاني.";
        K.UI.updateCameraModalStatus();
        return;
      }
      void K.AI.analyzeCapturedSubmission(mId, {
        frames,
        maxAvgLum: maxLum,
        audioBlob: wantsAudio ? audioBlob : null,
        isVideo: true,
      });
    };

    if (camCtrl.recorder && camCtrl.recorder.state !== "inactive") {
      const rec = camCtrl.recorder;
      const recMime = rec.mimeType || "audio/webm";
      rec.onstop = () => {
        const blob = camCtrl.chunks.length ? new Blob(camCtrl.chunks, { type: recMime }) : null;
        camCtrl.chunks = [];
        camCtrl.recorder = null;
        submitNow(blob);
      };
      try { rec.stop(); } catch { submitNow(null); }
    } else {
      submitNow(null);
    }
  }

  function toggleInAppRecord() {
    const st = K.state;
    if (st.videoAnalyzing) return;

    if (st.camera.recording) {
      K.SFX.play("click");
      finishInAppRecording();
      return;
    }

    if (!camCtrl.stream || !st.camera.ready) {
      K.showToast("استنى الكاميرا تفتح الأول");
      return;
    }

    K.SFX.play("click");
    st.camera.recording = true;
    st.camera.recSec = 0;
    st.videoVerdict = null;
    camCtrl.chunks = [];
    camCtrl.capturedFrames = [];
    camCtrl.capturedMaxLum = 0;
    camCtrl.startedAtMs = Date.now();
    camCtrl.recordingMissionId = st.activeCameraMissionId;

    // Grab initial frame immediately
    const firstSnap = grabLiveVideoFrame();
    if (firstSnap) {
      camCtrl.capturedFrames.push(firstSnap.b64);
      camCtrl.capturedMaxLum = firstSnap.avgLum;
    }

    // Grab a keyframe every 2 seconds while moving/chasing!
    camCtrl.frameTimer = setInterval(() => {
      if (!st.camera.recording) return;
      const snap = grabLiveVideoFrame();
      if (snap) {
        camCtrl.capturedFrames.push(snap.b64);
        if (snap.avgLum > camCtrl.capturedMaxLum) camCtrl.capturedMaxLum = snap.avgLum;
      }
    }, 2000);

    // Start MediaRecorder for speech missions (captures clear voice for Groq Whisper!)
    if (camCtrl.wantsAudio) {
      const opt = pickBestRecorderOptions(camCtrl.stream, true);
      if (opt) {
        try {
          const rec = opt.mimeType
            ? new MediaRecorder(opt.targetStream, { mimeType: opt.mimeType })
            : new MediaRecorder(opt.targetStream);
          rec.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) camCtrl.chunks.push(ev.data);
          };
          rec.start(250);
          camCtrl.recorder = rec;
        } catch {
          camCtrl.recorder = null;
        }
      }
    }

    // Live timer + auto-stop at 8 seconds so it stays super crisp & fast!
    camCtrl.recTimer = setInterval(() => {
      const sec = Math.min(st.camera.maxRecSec, (Date.now() - camCtrl.startedAtMs) / 1000);
      st.camera.recSec = sec;
      K.UI.updateCameraModalStatus();
      if (sec >= st.camera.maxRecSec) {
        finishInAppRecording();
      }
    }, 200);

    K.UI.updateCameraModalStatus();
  }

  K.Camera = {
    start: startInAppCamera,
    stop: stopInAppCamera,
    flip: flipInAppCamera,
    takePhoto: takeInAppPhoto,
    toggleRecord: toggleInAppRecord,
  };

  window.onCamFlip = () => K.Camera.flip();
  window.onCamTakePhoto = () => K.Camera.takePhoto();
  window.onCamToggleRecord = () => K.Camera.toggleRecord();
  window.onCamRetryStart = () => void K.Camera.start(K.state.activeCameraMissionId);


  window.onEnterPocketMode = () => {
    K.SFX.play("click");
    void K.WakeLock.acquire();
    setPocketMode(true);
  };

  window.onPocketOverlayTap = () => {
    const now = Date.now();
    if (now - K.state.lastPocketTapAt <= 550) {
      K.state.lastPocketTapAt = 0;
      K.SFX.play("click");
      setPocketMode(false);
      K.Map.resize();
      K.Map.updateLayers();
      K.UI.updateHudOnly();
    } else {
      K.state.lastPocketTapAt = now;
      const hint = document.getElementById("pocket-unlock-hint");
      if (hint) {
        hint.textContent = "اضغط مرة تانية سريعاً للفتح...";
        setTimeout(() => {
          const h = document.getElementById("pocket-unlock-hint");
          if (h) h.textContent = "اضغط مرتين سريعاً لفتح الشاشة";
        }, 650);
      }
    }
  };

  window.onResumeSavedSession = () => {
    const saved = peekSavedSession();
    if (!saved) {
      K.showToast("الجيم السابق انتهى");
      K.UI.renderPage();
      return;
    }
    const st = K.state;
    K.SFX.warmup();
    K.SFX.play("intel");
    st.isSimMode = Boolean(saved.isSimMode);
    st.lobby = saved.lobby || null;
    st.engine = K.KameenEngine.fromSnapshot(saved.snapshot);
    st.simTimeMs = saved.isSimMode ? saved.snapshot.nowMs : Date.now();
    st.roleRevealed = Boolean(saved.roleRevealed);
    st.roleFlipped = Boolean(saved.roleRevealed);
    st.eliminatedAck = false;
    if (!st.isSimMode && saved.code) {
      K.Network.connectRoomChannel(saved.code);
    }
    startEngineLoop();
    const targetRoute = saved.snapshot.phase === "MEETING"
      ? "meeting"
      : (st.isSimMode ? "simulation" : "game");
    navigate(targetRoute);
    K.showToast("تم استرجاع الجيم بنجاح");
  };

  window.onDiscardSavedSession = () => {
    clearSavedSession();
    K.UI.renderPage();
  };

  window.onRematchSameLobby = () => {
    const st = K.state;
    if (!st.lobby || st.lobby.hostId !== st.user.id) return;
    K.SFX.play("click");
    clearSavedSession();
    if (st.tickTimer) { clearInterval(st.tickTimer); st.tickTimer = null; }
    st.engine = null;
    st.lobby.started = false;
    st.lobby.matchId = "match-" + Date.now();
    st.roleRevealed = false;
    st.roleFlipped = false;
    st.eliminatedAck = false;
    st.lastIntel = null;
    st.recordedGameOverId = null;
    K.Network.broadcastLobbyState();
    navigate("lobby");
    K.showToast("تم فتح جولة جديدة في نفس الغرفة");
  };

  window.onToggleStrictCamera = () => {
    K.SFX.play("click");
    K.state.strictLiveCamera = !K.state.strictLiveCamera;
    try { localStorage.setItem("kameen_strict_cam", K.state.strictLiveCamera ? "1" : "0"); } catch {}
    K.UI.renderModal();
  };

  window.onInstallPwaApp = async () => {
    const promptEvt = K.state.deferredInstallPrompt;
    if (!promptEvt) return;
    K.SFX.play("click");
    try {
      promptEvt.prompt();
      await promptEvt.userChoice;
    } catch {}
    K.state.deferredInstallPrompt = null;
    if (K.state.route === "landing") K.UI.renderPage();
  };

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    K.state.deferredInstallPrompt = e;
    if (K.state.route === "landing") K.UI.renderPage();
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  K.App = {
    isMatchHost, startRealGps, recalibrateGps, startCompass, headingToArabic,
    requestCameraPerm, handleMapTap, navigate, dispatchAction,
    handleAuthoritativeAction, applyRemoteSnapshot, startEngineLoop,
    peekSavedSession,
  };

  try {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("join");
    if (inviteCode && inviteCode.trim().length >= 4) {
      K.state.joinCode = inviteCode.trim().toUpperCase();
    }
    const aiParam = params.get("ai");
    if (aiParam && aiParam.trim().startsWith("gsk_")) {
      K.state.groqKey = aiParam.trim();
      try { localStorage.setItem("kameen_groq_key", aiParam.trim()); } catch {}
    }
  } catch {}

  if (permsDone) startRealGps();
  navigate(K.state.route);
})(window.Kameen);
