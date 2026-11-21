"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const storedUid = localStorage.getItem("kameen_uid") || ("p-" + Math.random().toString(36).slice(2, 8));
  try { localStorage.setItem("kameen_uid", storedUid); } catch {}
  const storedName = localStorage.getItem("kameen_name") || "العميل X";
  const stats = K.loadStats();

  K.state = {
    route: "landing",
    mapStyle: "radar_streets",
    tileErrorCount: 0,
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
      accuracy: null,         // Fused accuracy (m)
      rawAccuracy: null,      // Raw GNSS accuracy (m)
      heading: null,          // degrees 0..359 (0=North, 90=East)
      headingSource: null,    // "compass" | "gps" | "fused" | "sim"
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
    camera: { status: "idle", error: null },
    groqKey: localStorage.getItem("kameen_groq_key") || K.CONFIG.DEFAULT_GROQ_KEY,
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
      pois: [],
      poiSource: null,
      panelCollapsed: false,
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
    aiBusy: false,
    videoAnalyzing: false,
    videoVerdict: null,
    modal: null,
    activeCameraMissionId: null,
    toast: null,
    toastTimer: null,
    glMap: null,
    selfMarker: null,
    selfMarkerColorKey: null,
    tickTimer: null,
    lastSyncBroadcastAt: 0,
    recordedGameOverId: null,
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
    if (fromUserGesture) {
      if (res.compassOk || res.motionOk) {
        K.showToast("🧭👣 تم تفعيل البوصلة وحساس الخطوات (PDR) لدقة أعلى!");
      } else {
        K.showToast("⚠️ المتصفح منع الحساسات — شغالين بالـ GPS الدقيق");
      }
      if (st.modal === "precision_hud" || st.modal === "permissions") K.UI.renderModal();
    }
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

    // Auto-center immediately on first real GPS fix OR better fix on Create Zone screen
    const rawAcc = tele.rawAcc || 20;
    if (isFirstRealFix || (!st.gps.userPickedZone && rawAcc + 3 < st.gps.bestCenterAcc && st.route === "create")) {
      st.gps.bestCenterAcc = rawAcc;
      st.createForm.center = { ...nextCoords };
      if (useRealHere) {
        K.Map.flyTo(nextCoords, 18.4, !isFirstRealFix);
      }
      if (st.route === "create") {
        void K.Map.fetchOverpassPOIs(nextCoords, st.createForm.radius);
      }
      st.gps.centeredOnce = true;
    }

    // Immediate 60fps smooth glide on every GPS fix AND every PDR footstep!
    if (useRealHere && (st.route === "game" || st.route === "simulation" || st.route === "create")) {
      K.Map.setSelfLiveCoords(nextCoords, true);
      // Fast precision badge update on the side FAB without full HUD rebuild
      const accBtn = document.getElementById("gps-acc-fab");
      if (accBtn && st.gps.accuracy !== null) {
        accBtn.textContent = "±" + (st.gps.accuracy < 10 ? st.gps.accuracy.toFixed(1) : Math.round(st.gps.accuracy));
      }
    }

    // Push fused location to game engine & multiplayer room (throttled to 650ms)
    if (st.engine && useRealHere && now - st.gps.lastSentAt >= 650) {
      st.gps.lastSentAt = now;
      dispatchAction("UPDATE_LOC", { coords: nextCoords });
    }

    K.UI.updateGpsStatusDOM();
    if (st.modal === "precision_hud") K.UI.updatePrecisionSheetDynamic();
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
      ? "رفضت إذن الموقع — افتحه من إعدادات المتصفح واختار (دقيق)"
      : (location.protocol !== "https:" && location.hostname !== "localhost")
        ? "الـ GPS محتاج رابط HTTPS (جيت هاب / فيرسل بيدعمه!)"
        : "لسه بيلقط أقمار GPS — اخرج للشارع أو البلكونة";
    K.UI.updateGpsStatusDOM();
  }

  function recalibrateGps() {
    const st = K.state;
    st.gps.hasRealFix = false;
    st.gps.bestCenterAcc = Infinity;
    st.mapFollowMe = true;
    st.simUseRealGps = true;
    K.showToast("📡 جاري المعايرة الفائقة للأقمار وحساسات الحركة...");
    K.Location.recalibrate(true);
    if (st.modal === "precision_hud") K.UI.updatePrecisionSheetDynamic();
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

  async function requestCameraPerm() {
    const st = K.state;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      stream.getTracks().forEach((t) => t.stop());
      st.camera.status = "granted";
      st.camera.error = null;
      K.showToast("📸 الكاميرا جاهزة يا باشا!");
    } catch {
      st.camera.status = "denied";
      st.camera.error = "مش عارف أفتح الكاميرا — اديني الإذن";
      K.showToast("⚠️ ادّي المتصفح إذن الكاميرا عشان المهام");
    }
    const cBtn = document.getElementById("perm-cam-btn");
    if (cBtn) cBtn.textContent = st.camera.status === "granted" ? "جاهزة ✅" : "تفعيل";
  }

  function handleMapTap(clicked) {
    const st = K.state;
    if (st.gps.anchorCalibrating) {
      const res = K.Location.setAnchorCalibration(clicked.lat, clicked.lng);
      st.gps.anchorCalibrating = false;
      document.body.classList.remove("anchor-calibrating");
      if (!res.ok) {
        K.showToast("⚠️ " + res.error);
      } else {
        K.SFX.play("win");
        K.showToast(`🎯 تم تثبيت موقعك بالظبط! (اتصحح ترحيل ${res.correctedMeters}م)`);
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
      K.showToast("📍 تمام! مركز الزون اتحرك للمكان ده");
    } else if (st.route === "simulation" && st.engine) {
      if (st.simUseRealGps) {
        st.simUseRealGps = false;
        K.showToast("🕹️ تحكم يدوي شغال — اضغط 📍 للرجوع لموقعك الحقيقي");
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

  function navigate(nextRoute) {
    const st = K.state;
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
      // Automatically boost HyperLock GPS + Compass + PDR Step Sensor whenever entering radar!
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
            "أنت المحلل النفسي في لعبة مطاردة شعبية اسمها كمين. رد بجملة واحدة روشة ومشوقة بالعامية المصرية بدون أي أسماء لاعبين.",
            `اكتب تلميح جريء يقول إن الغدّار موجود ${res.meta.place} على بعد حوالي ${res.meta.dist} متر. ممنوع تقول قطاع شمالي أو جنوبي.`
          );
          if (aiHint) res.intelText = "🔥 المحلل بيهمسلك: " + aiHint;
        }
        break;
      case "MISSION_START":
        res = st.engine.startMission(playerId, data.missionId, t);
        break;
      case "MISSION_COMPLETE":
        res = st.engine.completeMission(playerId, data.missionId, Boolean(data.videoVerified), t);
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
    } else if (st.route === "meeting") {
      K.UI.updateMeetingDynamic();
    } else if (st.route === "missions") {
      K.UI.renderPage();
    } else if (st.route === "result") {
      K.UI.updateResultChatDOM();
    }
  }

  function recordGameStats(snap) {
    const st = K.state;
    if (st.recordedGameOverId === snap.matchId) return;
    st.recordedGameOverId = snap.matchId;
    const me = snap.players[st.user.id];
    if (!me) return;
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

    if (snap.activeBrokerOffer && snap.activeBrokerOffer.id !== st.lastBrokerIdNotified) {
      st.lastBrokerIdNotified = snap.activeBrokerOffer.id;
      K.SFX.play("broker");
      K.showToast("🤝 صفقة سمسار سرية نزلت! الحقها من فوق!", 4500);
    }

    if (snap.activeAirdrop && snap.activeAirdrop.id !== st.lastAirdropIdNotified) {
      st.lastAirdropIdNotified = snap.activeAirdrop.id;
      K.SFX.play("airdrop");
      K.showToast(`💼 شنطة إمداد ذهبية نزلت ${snap.activeAirdrop.place}! اجري القطها!`, 4500);
    }

    if (snap.aiReports && snap.aiReports.length > 0) {
      const latest = snap.aiReports[snap.aiReports.length - 1];
      const formatted = `🤖 المحلل (${latest.source === "groq" ? "AI لايف" : "رادار"}): ${latest.summaryText}`;
      if (st.lastIntel !== formatted && Date.now() - latest.createdAtMs < 6000) {
        st.lastIntel = formatted;
        K.SFX.play("intel");
      }
    }

    const me = snap.players[st.user.id];
    if (me && !me.alive && !st.eliminatedAck && snap.phase !== "GAME_OVER") {
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

    if (snap.phase === "MEETING" && (st.route === "game" || st.route === "missions" || st.route === "simulation")) {
      navigate("meeting");
      return true;
    }
    if (snap.phase === "ACTIVE" && st.route === "meeting") {
      navigate(st.isSimMode ? "simulation" : "game");
      return true;
    }
    if (snap.phase === "GAME_OVER" && st.route !== "result") {
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
    } else if (st.route === "meeting") {
      K.UI.updateMeetingDynamic();
    } else if (st.route === "missions") {
      K.UI.updateMissionsDynamic();
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
        K.stepBots(st.engine, st.isSimMode ? 3.5 * st.simSpeed : 3.5);
        void K.AI.triggerProfilerReport(false);
        K.Network.broadcastMatchSnapshot(false);

        const snap = st.engine.getSnapshot();
        if (checkMatchTransitions(prevPhase, snap)) return;
      }

      if (st.route === "game" || st.route === "simulation") {
        const visNow = st.engine.getVisibleStateForPlayer(st.user.id);
        updateHeartbeatFx(visNow);
        K.Map.updateLayers();
        K.UI.updateHudOnly();
        if (st.modal === "missions_sheet") K.UI.updateMissionsDynamic();
        if (st.modal === "precision_hud") K.UI.updatePrecisionSheetDynamic();
      } else if (st.route === "meeting") {
        K.UI.updateMeetingDynamic();
      }
    }, 1000);
  }

  function joinLobbyByCode(rawCode) {
    const st = K.state;
    const code = (rawCode || "").trim().toUpperCase();
    if (code.length < 4) return K.showToast("⚠️ اكتب كود الروم الأول يا صاحبي (مثال KMN402)");
    K.SFX.play("click");

    const localRaw = localStorage.getItem("kameen_lobby_" + code);
    if (localRaw) {
      const lobby = JSON.parse(localRaw);
      if (!lobby.players.some((p) => p.id === st.user.id)) {
        lobby.players.push({
          id: st.user.id, name: st.user.name || "العميل X",
          isBot: false, isHost: false, isReady: true, coords: st.gps.coords,
        });
        try { localStorage.setItem("kameen_lobby_" + code, JSON.stringify(lobby)); } catch {}
      }
      st.lobby = lobby;
      K.Network.connectRoomChannel(code);
      navigate("lobby");
      return;
    }

    K.showToast("🔍 بندوّر على الروم " + code + " في سوبابيس...");
    K.Network.connectRoomChannel(code, () => {
      const sendJoin = () => {
        K.Network.sendRaw("JOIN_REQ", {
          player: {
            id: st.user.id,
            name: st.user.name || "العميل X",
            coords: st.gps.coords,
          },
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
          K.showToast("❌ ملقيناش روم بالكود ده! اتأكد إن صاحبك فاتح اللوبي");
        }
      }, 7500);
    });
  }

  // =========================================================================
  // GLOBAL EVENT HANDLERS
  // =========================================================================
  window.onNav = (route) => { K.SFX.play("click"); navigate(route); };
  window.onOpenModal = (name) => { K.SFX.play("click"); K.state.modal = name; K.UI.renderModal(); };
  window.onCloseModal = () => {
    K.state.modal = null;
    K.UI.renderModal();
    if (K.state.route === "game" || K.state.route === "simulation") K.UI.updateHudOnly();
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
    K.state.createForm.center = { ...K.state.gps.coords };
    K.Map.recenter();
    void K.Map.fetchOverpassPOIs(K.state.createForm.center, K.state.createForm.radius);
    K.Map.updateLayers();
    K.showToast("📍 الزون اتظبطت على مكانك الحالي!");
  };

  window.onToggleCreatePanel = () => {
    K.state.createForm.panelCollapsed = !K.state.createForm.panelCollapsed;
    K.UI.updateHudOnly();
  };

  window.onSetCreateField = (field, val) => {
    K.SFX.play("click");
    K.state.createForm[field] = val;
    K.UI.updateHudOnly();
  };

  window.onRadiusSlide = (val) => {
    K.state.createForm.radius = Number(val);
    K.Map.updateLayers();
    const lbl = document.getElementById("create-radius-lbl");
    if (lbl) {
      lbl.innerHTML = `نصف القطر: <span style="color:var(--gold);">${val}م</span> • ${K.state.createForm.pois.length} نقطة (${K.escHtml(K.state.createForm.poiSource || "جاهز")})`;
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
      pois,
      players: [{
        id: st.user.id, name: st.user.name || "العميل X",
        isBot: false, isHost: true, isReady: true, coords: st.gps.coords,
      }],
      started: false,
    };
    K.Network.connectRoomChannel(code, () => {
      K.Network.broadcastLobbyState();
      K.showToast(`✅ الروم اتفتح! ابعت كود ${code} لصحابك`);
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
    K.showToast("📋 الكود اتنسخ! ابعته لصحابك");
  };

  window.onShareWhatsApp = () => {
    if (!K.state.lobby) return;
    const baseUrl = window.location.origin + window.location.pathname;
    const inviteUrl = `${baseUrl}?join=${K.state.lobby.code}`;
    const msg = `🔥 انزل العب معايا "كمين" على أرض الواقع!\n🔑 كود الروم: ${K.state.lobby.code}\n🚀 ادخل على طول من اللينك ده:\n${inviteUrl}`;
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
      name: K.BOT_NAMES[idx % K.BOT_NAMES.length] + " 🤖",
      isBot: true, isHost: false, isReady: true,
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
    if (st.lobby.players.length < 3) {
      return K.showToast("⚠️ لازم 3 لاعبين على الأقل عشان الجيم يشتغل (تقدر تضيف بوتات!)");
    }
    K.SFX.play("alarm");
    const t0 = Date.now();
    st.isSimMode = false;
    // Always sync host's latest real GPS coordinates before creating the match!
    const hostEntry = st.lobby.players.find((p) => p.id === st.user.id);
    if (hostEntry && st.gps.hasRealFix) hostEntry.coords = { ...st.gps.coords };
    st.engine = new K.KameenEngine({
      matchId: st.lobby.matchId, code: st.lobby.code, hostId: st.lobby.hostId,
      title: st.lobby.title, zoneCenter: st.lobby.center, zoneRadiusMeters: st.lobby.radius,
      durationMinutes: st.lobby.duration, spreadSeconds: st.lobby.spreadSeconds ?? 60,
      imposterCount: st.lobby.imposters, pois: st.lobby.pois, seed: t0,
    }, st.lobby.players, t0);
    st.simTimeMs = t0;
    st.lobby.started = true;
    st.roleRevealed = false;
    st.roleFlipped = false;
    st.eliminatedAck = false;
    st.lastIntel = null;
    st.lastBrokerIdNotified = null;
    st.lastAirdropIdNotified = null;
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
      { id: st.user.id, name: st.user.name || "العميل X", isBot: false, isHost: true, isReady: true, coords: { ...center } },
      ...K.BOT_NAMES.slice(0, 6).map((n, i) => ({
        id: "sim-bot-" + i, name: n + " 🤖", isBot: true, isHost: false, isReady: true,
        coords: K.Geo.offsetCoordinates(center, Math.cos(i) * 30, Math.sin(i) * 30),
      })),
    ];
    st.isSimMode = true;
    st.simUseRealGps = true;
    st.simSpeed = 1;
    st.simRunning = true;
    st.simDpadVisible = false;
    st.simTimeMs = t0;
    const initialPois = (st.createForm.pois && st.createForm.pois.length >= 2)
      ? st.createForm.pois
      : K.Geo.generateFallbackPOIs(center, 220);
    st.engine = new K.KameenEngine({
      matchId: "sim-lab-" + t0, code: "SIM001", hostId: st.user.id, title: "مختبر المحاكاة",
      zoneCenter: center, zoneRadiusMeters: 220, durationMinutes: 15, spreadSeconds: 25,
      imposterCount: 1, pois: initialPois, seed: t0,
    }, bots, t0);
    // Fetch real street & landmark names from the map around current GPS for Simulation too!
    void K.Map.fetchOverpassPOIs(center, 220, true);
    st.roleRevealed = false;
    st.roleFlipped = false;
    st.eliminatedAck = false;
    st.lastIntel = null;
    st.lastBrokerIdNotified = null;
    st.lastAirdropIdNotified = null;
    startEngineLoop();
    navigate("simulation");
  };

  window.onFlipRoleCard = () => { K.SFX.play("intel"); K.state.roleFlipped = true; K.UI.renderModal(); };
  window.onAcceptRoleCard = () => { K.SFX.play("click"); K.state.roleRevealed = true; K.UI.renderModal(); };
  window.onKillTarget = (targetId) => dispatchAction("KILL", { targetId });
  window.onReportBody = (bodyId) => dispatchAction("REPORT", { bodyId });
  window.onCastVote = (targetId) => dispatchAction("VOTE", { targetId });
  window.onClaimAirdrop = () => dispatchAction("CLAIM_AIRDROP");
  window.onAcceptBroker = (choice) => { K.state.modal = null; K.UI.renderModal(); dispatchAction("BROKER", { choice }); };
  window.onUseAbility = (type) => { K.state.modal = null; K.UI.renderModal(); dispatchAction(type); };
  window.onScanPlace = (placeId) => { K.state.modal = null; K.UI.renderModal(); dispatchAction("LOC_Q", { placeId }); };
  window.onSpokenName = (accusedId) => { K.state.modal = null; K.UI.renderModal(); dispatchAction("SPOKEN", { accusedId }); };

  window.onStartMission = (missionId) => {
    K.state.modal = null;
    K.UI.renderModal();
    dispatchAction("MISSION_START", { missionId });
  };

  window.openCameraForMission = (missionId) => {
    K.state.activeCameraMissionId = missionId;
    K.state.videoVerdict = null;
    K.state.videoAnalyzing = false;
    K.state.modal = "camera";
    K.UI.renderModal();
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
      K.showToast(r.role === "IMPOSTER" ? "😈 بقيت إنت الغدّار (إمبوستر)!" : "🕵️ بقيت إنت مفتش (محقق)!");
      K.UI.updateHudOnly();
    }
  };
  window.onSimSkipSpread = () => { K.state.engine?.skipSpread(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };
  window.onSimForceAI = () => { K.showToast("🤖 بنكلّم الذكاء الاصطناعي..."); void K.AI.triggerProfilerReport(true); };
  window.onSimSpawnAirdrop = () => { K.state.engine?.spawnAirdrop(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };
  window.onSimTriggerBroker = () => { K.state.engine?.triggerBrokerOffer(4, K.state.simTimeMs); K.UI.updateHudOnly(); };
  window.onSimShrinkZone = () => { K.state.engine?.shrinkZone(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };
  window.onSimRadar = () => { K.state.engine?.triggerLocationReveal(K.state.simTimeMs); K.Map.updateLayers(); K.UI.updateHudOnly(); };

  window.exitGameToLanding = () => {
    if (K.state.tickTimer) clearInterval(K.state.tickTimer);
    K.Network.disconnectRoomChannel();
    K.WakeLock.release();
    K.setDangerVignette(false);
    updateHeartbeatFx(null);
    K.state.isSimMode = false;
    K.state.engine = null;
    K.state.lobby = null;
    K.state.modal = null;
    navigate("landing");
  };

  window.exitGameToCreate = () => {
    if (K.state.tickTimer) clearInterval(K.state.tickTimer);
    K.Network.disconnectRoomChannel();
    K.WakeLock.release();
    K.setDangerVignette(false);
    updateHeartbeatFx(null);
    K.state.isSimMode = false;
    K.state.engine = null;
    K.state.lobby = null;
    K.state.modal = null;
    navigate("create");
  };

  window.addEventListener("resize", () => {
    K.Map.resize();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && (K.state.route === "game" || K.state.route === "simulation")) {
      void K.WakeLock.acquire();
    }
  });

  window.onRecalibrateGps = () => recalibrateGps();
  window.onEnableCompass = () => { void startCompass(true); };
  window.onStartAnchorCalibration = () => {
    const st = K.state;
    if (!st.gps.hasRealFix) {
      return K.showToast("⚠️ استنى الـ GPS يلقط موقعك الأول قبل الضبط اليدوي");
    }
    if (st.route !== "create" && st.route !== "game" && st.route !== "simulation") {
      return K.showToast("📍 ادخل الخريطة الأول عشان تضبط مكانك عليها");
    }
    st.modal = null;
    st.gps.anchorCalibrating = true;
    st.simUseRealGps = true;
    document.body.classList.add("anchor-calibrating");
    K.UI.renderModal();
    K.UI.updateHudOnly();
    K.showToast("🎯 اضغط على مكانك الحقيقي بالظبط على الخريطة دلوقتي!", 4500);
  };
  window.onCancelAnchorCalibration = () => {
    K.state.gps.anchorCalibrating = false;
    document.body.classList.remove("anchor-calibrating");
    K.UI.updateHudOnly();
  };
  window.onClearAnchorCalibration = () => {
    K.Location.clearAnchorCalibration();
    K.SFX.play("click");
    K.showToast("🔄 تم إلغاء التعديل اليدوي والرجوع لقراءة الأقمار");
    if (K.state.modal === "precision_hud") K.UI.updatePrecisionSheetDynamic();
    K.Map.updateLayers();
  };

  K.App = {
    isMatchHost,
    startRealGps,
    recalibrateGps,
    startCompass,
    headingToArabic,
    requestCameraPerm,
    handleMapTap,
    navigate,
    dispatchAction,
    handleAuthoritativeAction,
    applyRemoteSnapshot,
    startEngineLoop,
  };

  try {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("join");
    if (inviteCode && inviteCode.trim().length >= 4) {
      K.state.joinCode = inviteCode.trim().toUpperCase();
      K.showToast(`🔑 كود الروم ${K.state.joinCode} اتملى تلقائي! اضغط "ادخل 🚀"`);
    }
  } catch {}

  startRealGps();
  navigate("landing");
})(window.Kameen);
