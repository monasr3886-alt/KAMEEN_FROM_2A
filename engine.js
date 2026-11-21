"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const C = K.GAME_CONSTANTS;
  const EARTH_RADIUS_M = 6371e3;

  function toRadians(deg) { return (deg * Math.PI) / 180; }

  function distanceMeters(a, b) {
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const sLat = Math.sin(dLat / 2);
    const sLng = Math.sin(dLng / 2);
    const h = sLat * sLat + Math.cos(lat1) * Math.cos(lat2) * sLng * sLng;
    return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  function isInsideZone(pt, center, r) {
    return distanceMeters(pt, center) <= r;
  }

  function getArabicDirection(from, to) {
    const angle = (Math.atan2(to.lng - from.lng, to.lat - from.lat) * 180) / Math.PI;
    const n = (angle + 360) % 360;
    if (n >= 337.5 || n < 22.5) return "شمال";
    if (n < 67.5) return "شمال شرق";
    if (n < 112.5) return "شرق";
    if (n < 157.5) return "جنوب شرق";
    if (n < 202.5) return "جنوب";
    if (n < 247.5) return "جنوب غرب";
    if (n < 292.5) return "غرب";
    return "شمال غرب";
  }

  function getNearestPOI(pt, pois) {
    if (!pois || !pois.length) return null;
    let best = pois[0];
    let bestDist = distanceMeters(pt, { lat: best.lat, lng: best.lng });
    for (let i = 1; i < pois.length; i++) {
      const d = distanceMeters(pt, { lat: pois[i].lat, lng: pois[i].lng });
      if (d < bestDist) { bestDist = d; best = pois[i]; }
    }
    return { poi: best, dist: bestDist };
  }

  function getNearbyPlaceLabel(pt, pois) {
    const nearest = getNearestPOI(pt, pois);
    if (!nearest) return "جوه المنطقة";
    const name = nearest.poi.name;
    if (nearest.dist <= 22) return `عند ${name}`;
    if (nearest.dist <= 115) return `قريب من ${name}`;
    return `حوالين ${name}`;
  }

  function offsetCoordinates(origin, northM, eastM) {
    const dLat = northM / EARTH_RADIUS_M;
    const dLng = eastM / (EARTH_RADIUS_M * Math.cos(toRadians(origin.lat)));
    return {
      lat: origin.lat + (dLat * 180) / Math.PI,
      lng: origin.lng + (dLng * 180) / Math.PI,
      accuracyMeters: origin.accuracyMeters ?? 5,
    };
  }

  function createSeededRng(seed) {
    let s = (seed >>> 0) || 1337;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function randomPointInZone(center, r, rng = Math.random, maxFrac = 0.76) {
    const dist = Math.sqrt(rng()) * r * maxFrac;
    const theta = rng() * Math.PI * 2;
    return offsetCoordinates(center, Math.cos(theta) * dist, Math.sin(theta) * dist);
  }

  function generateFallbackPOIs(center, radiusMeters, rng = Math.random) {
    const templates = [
      { name: "ساحة الحي", category: "square" },
      { name: "الجنينة العمومية", category: "park" },
      { name: "ممشى المنطقة", category: "pedestrian" },
      { name: "قهوة الناصية", category: "cafe" },
      { name: "الصيدلية القريبة", category: "pharmacy" },
      { name: "الملعب المفتوح", category: "playground" },
      { name: "المخبز", category: "shop" },
      { name: "المسجد", category: "mosque" },
      { name: "سوق الحي", category: "shop" },
    ];
    return templates.map((tpl, i) => {
      const angle = (i / templates.length) * Math.PI * 2 + rng() * 0.25;
      const dist = radiusMeters * (0.28 + rng() * 0.44);
      const c = offsetCoordinates(center, Math.cos(angle) * dist, Math.sin(angle) * dist);
      return { id: "poi-" + (i + 1), name: tpl.name, category: tpl.category, lat: c.lat, lng: c.lng };
    });
  }

  const INVESTIGATOR_MISSIONS = [
    {
      type: "EVIDENCE_SCAN",
      title: "رفع بصمات المكان 🔍",
      description: (p) => `انزل على ${p} وصوّر صورة أو فيديو سريع تجمع بيه دليل لقضية الشلة.`,
      baseTimeSec: 75, rewardPoints: 30,
    },
    {
      type: "AREA_SWEEP",
      title: "تأمين النقطة السخنة 📍",
      description: (p) => `عدّي على ${p} وخد لقطة تثبت إن المكان أمان وزوّد شريط التحقيق.`,
      baseTimeSec: 75, rewardPoints: 25,
    },
    {
      type: "CIPHER_CHECK",
      title: "فك شفرة الميدان 🔐",
      description: (p) => `وصل لحد ${p} من سكات وصوّر إثبات الوصول عشان تقفل جزء من القضية.`,
      baseTimeSec: 65, rewardPoints: 35,
    },
    {
      type: "TIMED_INTEL",
      title: "سباق الأدلة ⏱️",
      description: (p) => `الحق ${p} قبل ما العداد يخلص وارفع إثبات الكاميرا فوراً!`,
      baseTimeSec: 60, rewardPoints: 40,
    },
  ];

  const IMPOSTER_COVER_MISSIONS = [
    {
      type: "COVER_ALIBI",
      title: "تمثيلية البريء 🎭",
      description: (p) => `اتحرك لحد ${p} وصوّر لقطة سريعة عشان تبعد الشكوك وتلم نقط لألاعيبك!`,
      baseTimeSec: 75, rewardPoints: 35,
    },
    {
      type: "COVER_STASH",
      title: "تمويل التشويش ⚡",
      description: (p) => `عدّي عند ${p} ووثّق مرورك عشان تاخد نقط تشغّل بيها تكتيم المحلل!`,
      baseTimeSec: 75, rewardPoints: 35,
    },
    {
      type: "COVER_DECOY",
      title: "زرع أثر وهمي 😈",
      description: (p) => `لف ناحية ${p} وخد لقطة سريعة تظبّط بيها خطة التمويه وتكسب نقط!`,
      baseTimeSec: 70, rewardPoints: 30,
    },
  ];

  function calculateDynamicMissionSeconds(playerCoords, poi, baseTimeSec = 70) {
    const dist = distanceMeters(playerCoords, { lat: poi.lat, lng: poi.lng });
    return baseTimeSec + Math.ceil(dist / 0.95);
  }

  function generatePlayerMissions(playerId, role, playerCoords, pois, center, radiusMeters, rng) {
    const poolPOIs = pois && pois.length >= 3 ? [...pois] : generateFallbackPOIs(center, radiusMeters, rng);
    const tplSource = role === "IMPOSTER" ? IMPOSTER_COVER_MISSIONS : INVESTIGATOR_MISSIONS;
    const selectedPOIs = [];
    const availPOIs = [...poolPOIs];
    for (let i = 0; i < 3; i++) {
      const idx = Math.floor(rng() * availPOIs.length);
      selectedPOIs.push(availPOIs.splice(idx, 1)[0] ?? poolPOIs[i % poolPOIs.length]);
    }
    const poolTpls = [...tplSource];
    return selectedPOIs.map((poi, idx) => {
      const tIdx = Math.floor(rng() * poolTpls.length);
      const tpl = poolTpls.splice(tIdx, 1)[0] ?? tplSource[idx % tplSource.length];
      const est = calculateDynamicMissionSeconds(playerCoords, poi, tpl.baseTimeSec);
      return {
        id: `mission-${playerId}-${idx + 1}`,
        playerId,
        isCover: role === "IMPOSTER",
        type: tpl.type,
        title: tpl.title,
        description: tpl.description(poi.name),
        poi,
        rewardPoints: tpl.rewardPoints,
        status: "pending",
        startedAtMs: null,
        deadlineMs: null,
        estimatedDurationSec: est,
        completedAtMs: null,
        gpsVerified: false,
        videoVerified: false,
      };
    });
  }

  class KameenEngine {
    constructor(config, lobbyPlayers, nowMs = Date.now()) {
      this.rng = createSeededRng(config.seed ?? nowMs);
      this.eventCounter = 0;
      this.state = this.buildInitialSnapshot(config, lobbyPlayers, nowMs);
    }

    static fromSnapshot(snapshot, seed = Date.now()) {
      const engine = Object.create(KameenEngine.prototype);
      engine.state = JSON.parse(JSON.stringify(snapshot));
      engine.rng = createSeededRng(seed);
      engine.eventCounter = (snapshot.events || []).length + 20;
      return engine;
    }

    nextEventId(prefix) {
      this.eventCounter += 1;
      return `${prefix}-${this.eventCounter}`;
    }

    pushEvent(type, message, nowMs, actorId, targetId) {
      this.state.events.push({
        id: this.nextEventId("evt"),
        timestampMs: nowMs,
        type, message, actorId, targetId,
      });
      if (this.state.events.length > 70) this.state.events.shift();
    }

    buildInitialSnapshot(config, lobbyPlayers, nowMs) {
      const spreadMs = (config.spreadSeconds ?? 60) * 1000;
      const playerIds = lobbyPlayers.map((p) => p.id);
      const roles = this.assignRolesFairly(playerIds, config.imposterCount);
      const nextZoneCenter = this.computeNextZoneCenter(config.zoneCenter, config.zoneRadiusMeters);
      const nextZoneRadius = Math.round(config.zoneRadiusMeters * C.ZONE_SHRINK_FACTOR);
      const zonePois = (config.pois && config.pois.length >= 2)
        ? config.pois.map((p) => ({ ...p }))
        : generateFallbackPOIs(config.zoneCenter, config.zoneRadiusMeters, this.rng);
      const players = {};
      const missions = {};
      let initialInvCount = 0;

      lobbyPlayers.forEach((lp, idx) => {
        const role = roles[lp.id] ?? "INVESTIGATOR";
        if (role === "INVESTIGATOR") initialInvCount += 1;
        let coords = lp.coords;
        if (!coords || !isInsideZone(coords, config.zoneCenter, config.zoneRadiusMeters * 0.9)) {
          coords = randomPointInZone(config.zoneCenter, config.zoneRadiusMeters, this.rng, 0.3);
        }
        players[lp.id] = {
          id: lp.id, name: lp.name, isBot: Boolean(lp.isBot), isHost: Boolean(lp.isHost), isReady: true,
          botIndex: idx,
          role, alive: true, eliminationReason: null, eliminatedAtMs: null,
          coords: { ...coords }, lastCoords: { ...coords }, lastTelemetryAtMs: nowMs,
          speedMps: 0, maxRecentSpeedMps: 0, peakSpeedMps: 0,
          stationarySeconds: 0, totalStationarySec: 0,
          killsCount: 0, airdropsClaimed: 0, missionsCompleted: 0,
          points: C.INITIAL_POINTS,
          stealthUsesRemaining: 1, stealthArmedForNextReveal: false, stealthActiveInCurrentReveal: false,
          protectedUntilMs: 0,
          killCooldownUntilMs: nowMs + spreadMs + C.ACTIVE_START_GRACE_MS,
          outsideZoneSinceMs: null, brokerRedBroadcastUntilMs: 0,
          spokenNameCooldownUntilMs: 0,
        };
        missions[lp.id] = generatePlayerMissions(
          lp.id, role, coords, zonePois, config.zoneCenter, config.zoneRadiusMeters, this.rng
        );
      });

      const missionGoal = Math.max(3, Math.min(12, initialInvCount * 2));

      return {
        matchId: config.matchId,
        code: config.code,
        hostId: config.hostId,
        phase: "SPREAD",
        winner: null,
        winReason: null,
        aiMatchRecap: null,
        startedAtMs: nowMs,
        nowMs,
        activeElapsedMs: 0,
        matchDurationMs: (config.durationMinutes || 15) * 60000,
        spreadEndsAtMs: nowMs + spreadMs,
        revealEndsAtMs: 0,
        nextRevealAtActiveMs: C.REVEAL_INTERVAL_MS,
        nextAiReportAtActiveMs: C.AI_REPORT_INTERVAL_MS,
        nextAirdropAtActiveMs: C.AIRDROP_INTERVAL_MS,
        aiJammedUntilMs: 0,
        showdownActive: false,
        brokerMinute4Triggered: false,
        brokerMinute8Triggered: false,
        activeBrokerOffer: null,
        activeAirdrop: null,
        decoyPing: null,
        recentEncounters: [],
        investigationDone: 0,
        investigationGoal: missionGoal,
        pois: zonePois,
        zone: {
          center: config.zoneCenter,
          initialRadiusMeters: config.zoneRadiusMeters,
          currentRadiusMeters: config.zoneRadiusMeters,
          nextCenter: nextZoneCenter,
          nextRadiusMeters: nextZoneRadius,
          shrinkCount: 0,
          nextShrinkAtActiveMs: C.ZONE_SHRINK_INTERVAL_MS,
        },
        players,
        missions,
        bodies: [],
        activeMeeting: null,
        aiReports: [],
        postChat: [],
        events: [
          {
            id: "evt-0",
            timestampMs: nowMs,
            type: "MATCH_STARTED",
            message: `بدأ الكمين! عندكم ${Math.round(spreadMs / 1000)} ثانية تتشتتوا في المنطقة.. محدش باين لحد دلوقتي!`,
          },
        ],
      };
    }

    assignRolesFairly(playerIds, requestedImposters) {
      const shuffled = [...playerIds];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const maxImp = shuffled.length >= 6 ? 2 : 1;
      const safeCount = Math.max(1, Math.min(requestedImposters || 1, maxImp));
      const roles = {};
      shuffled.forEach((id, idx) => { roles[id] = idx < safeCount ? "IMPOSTER" : "INVESTIGATOR"; });
      return roles;
    }

    computeNextZoneCenter(curr, radiusM) {
      const maxShift = radiusM * 0.2;
      const angle = this.rng() * Math.PI * 2;
      const dist = this.rng() * maxShift;
      return offsetCoordinates(curr, Math.cos(angle) * dist, Math.sin(angle) * dist);
    }

    getSnapshot() { return JSON.parse(JSON.stringify(this.state)); }
    getLivingPlayers() { return Object.values(this.state.players).filter((p) => p.alive); }

    enterActivePhase(nowMs) {
      this.state.phase = "ACTIVE";
      this.state.revealEndsAtMs = 0;
      this.state.activeElapsedMs = 0;
      for (const p of Object.values(this.state.players)) {
        p.outsideZoneSinceMs = null;
        p.killCooldownUntilMs = nowMs + C.ACTIVE_START_GRACE_MS;
      }
      this.pushEvent("PHASE_CHANGED", "🔥 وقت التشتيت خلص! اللعب الجد بدأ — عندكم 25 ثانية أمان قبل ما التفنيش يتفتح!", nowMs);
    }

    skipSpread(nowMs = this.state.nowMs) {
      if (this.state.phase === "SPREAD") {
        this.state.spreadEndsAtMs = nowMs;
        this.enterActivePhase(nowMs);
      }
    }

    setPOIs(newPois) {
      if (!newPois || !newPois.length) return;
      this.state.pois = newPois.map((p) => ({ ...p }));
      const allTpls = [...INVESTIGATOR_MISSIONS, ...IMPOSTER_COVER_MISSIONS];
      let idx = 0;
      for (const list of Object.values(this.state.missions)) {
        for (const m of list) {
          if (m.status === "pending") {
            const poi = this.state.pois[idx % this.state.pois.length];
            idx += 1;
            const tpl = allTpls.find((t) => t.type === m.type);
            m.poi = { ...poi };
            if (tpl) m.description = tpl.description(poi.name);
          }
        }
      }
    }

    getScanLandmarks() {
      const list = this.state.pois || [];
      return list.slice(0, 6).map((p) => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng }));
    }

    simTogglePlayerRole(playerId) {
      const p = this.state.players[playerId];
      if (!p) return { ok: false };
      const nextRole = p.role === "IMPOSTER" ? "INVESTIGATOR" : "IMPOSTER";
      p.role = nextRole;
      if (nextRole === "IMPOSTER") {
        for (const x of Object.values(this.state.players)) {
          if (x.id !== playerId && x.isBot && x.role === "IMPOSTER") {
            x.role = "INVESTIGATOR";
          }
        }
      } else {
        const imps = Object.values(this.state.players).filter((x) => x.alive && x.role === "IMPOSTER");
        if (imps.length === 0) {
          const bot = Object.values(this.state.players).find((x) => x.isBot && x.alive);
          if (bot) bot.role = "IMPOSTER";
        }
      }
      // Regenerate player's missions to match their new role logically!
      this.state.missions[playerId] = generatePlayerMissions(
        playerId, nextRole, p.coords, this.state.pois,
        this.state.zone.center, this.state.zone.currentRadiusMeters, this.rng
      );
      if (this.state.phase === "ACTIVE") {
        p.killCooldownUntilMs = this.state.nowMs;
      }
      return { ok: true, role: nextRole };
    }

    getVisibleStateForPlayer(viewerId) {
      const self = this.state.players[viewerId] || Object.values(this.state.players)[0];
      const nowMs = this.state.nowMs;
      const isSpread = this.state.phase === "SPREAD";
      const isRevealActive = !isSpread && this.state.revealEndsAtMs > nowMs;
      const isGameOver = this.state.phase === "GAME_OVER";
      const isGhost = !self.alive && !isSpread;

      const players = Object.values(this.state.players).map((p) => {
        const isSelf = p.id === self.id;
        const isPartner = self.role === "IMPOSTER" && p.role === "IMPOSTER";
        const isRedBroadcast = !isSpread && p.alive && p.brokerRedBroadcastUntilMs > nowMs;

        const canSeeCoords = isSpread
          ? isSelf
          : (isSelf || isGameOver || isGhost || isRedBroadcast || (isRevealActive && p.alive && !p.stealthActiveInCurrentReveal));

        const canSeeRole = isSelf || isGameOver || isPartner || isGhost;
        return {
          id: p.id, name: p.name, isBot: p.isBot, isHost: p.isHost, alive: p.alive,
          role: canSeeRole ? p.role : "HIDDEN",
          coords: canSeeCoords ? p.coords : null,
          isRedBrokerBroadcast: isRedBroadcast,
          isProtected: p.protectedUntilMs > nowMs,
          points: isSelf ? p.points : undefined,
        };
      });

      const imposterPartners = self.role === "IMPOSTER"
        ? Object.values(this.state.players)
            .filter((p) => p.role === "IMPOSTER" && p.id !== self.id)
            .map((p) => ({ id: p.id, name: p.name }))
        : [];

      // Imposter-exclusive proximity telemetry (only distance + nearest target id when active)
      let nearestTarget = null;
      if (self.role === "IMPOSTER" && self.alive && !isSpread) {
        const invs = Object.values(this.state.players).filter((p) => p.alive && p.role === "INVESTIGATOR");
        let best = null, bestD = Infinity;
        for (const inv of invs) {
          const d = distanceMeters(self.coords, inv.coords);
          if (d < bestD) { bestD = d; best = inv; }
        }
        if (best) {
          nearestTarget = {
            id: best.id,
            name: bestD <= C.NEARBY_TARGET_DISTANCE_M ? best.name : null,
            dist: Math.round(bestD),
            inKillRange: bestD <= C.KILL_BASE_DISTANCE_M + Math.min((self.coords.accuracyMeters ?? 5) * 0.6, 7),
            inSenseRange: bestD <= C.NEARBY_TARGET_DISTANCE_M,
          };
        }
      }

      const outsideZoneRemainingMs = !isSpread && self.alive && self.outsideZoneSinceMs !== null
        ? Math.max(0, C.OUTSIDE_ZONE_GRACE_MS - (nowMs - self.outsideZoneSinceMs))
        : null;

      const decoyPing = (!isSpread && this.state.decoyPing && this.state.decoyPing.expiresAtMs > nowMs)
        ? this.state.decoyPing : null;

      const activeAirdrop = (!isSpread && this.state.activeAirdrop && this.state.activeAirdrop.expiresAtMs > nowMs)
        ? this.state.activeAirdrop : null;

      const postSpreadGraceSec = (this.state.phase === "ACTIVE" && this.state.activeElapsedMs < C.ACTIVE_START_GRACE_MS)
        ? Math.ceil((C.ACTIVE_START_GRACE_MS - this.state.activeElapsedMs) / 1000)
        : 0;

      return {
        matchId: this.state.matchId, code: this.state.code, hostId: this.state.hostId,
        phase: this.state.phase, winner: this.state.winner, winReason: this.state.winReason,
        aiMatchRecap: this.state.aiMatchRecap,
        nowMs, activeElapsedMs: this.state.activeElapsedMs,
        remainingMatchMs: Math.max(0, this.state.matchDurationMs - this.state.activeElapsedMs),
        spreadRemainingMs: isSpread ? Math.max(0, this.state.spreadEndsAtMs - nowMs) : 0,
        postSpreadGraceSec,
        revealRemainingMs: isRevealActive ? Math.max(0, this.state.revealEndsAtMs - nowMs) : 0,
        nextShrinkInMs: Math.max(0, this.state.zone.nextShrinkAtActiveMs - this.state.activeElapsedMs),
        isRevealActive, showdownActive: this.state.showdownActive,
        aiJammed: this.state.aiJammedUntilMs > nowMs,
        aiJammedRemainingSec: this.state.aiJammedUntilMs > nowMs ? Math.ceil((this.state.aiJammedUntilMs - nowMs) / 1000) : 0,
        outsideZoneRemainingMs, decoyPing, activeAirdrop, nearestTarget,
        investigationDone: this.state.investigationDone || 0,
        investigationGoal: this.state.investigationGoal || 4,
        landmarks: this.getScanLandmarks(),
        zone: JSON.parse(JSON.stringify(this.state.zone)),
        self: JSON.parse(JSON.stringify(self)),
        imposterPartners,
        players,
        missions: JSON.parse(JSON.stringify(this.state.missions[self.id] ?? [])),
        bodies: JSON.parse(JSON.stringify(this.state.bodies)),
        activeMeeting: JSON.parse(JSON.stringify(this.state.activeMeeting)),
        activeBrokerOffer: JSON.parse(JSON.stringify(this.state.activeBrokerOffer)),
        aiReports: JSON.parse(JSON.stringify(this.state.aiReports)),
        postChat: JSON.parse(JSON.stringify(this.state.postChat || [])),
        events: JSON.parse(JSON.stringify(this.state.events)),
        awards: isGameOver ? this.computeAwards() : [],
      };
    }

    tick(nextNowMs) {
      if (nextNowMs <= this.state.nowMs || this.state.phase === "GAME_OVER") {
        return this.getSnapshot();
      }
      const deltaMs = nextNowMs - this.state.nowMs;
      const deltaSec = deltaMs / 1000;
      this.state.nowMs = nextNowMs;

      if (this.state.phase === "SPREAD") {
        if (nextNowMs >= this.state.spreadEndsAtMs) this.enterActivePhase(nextNowMs);
        return this.getSnapshot();
      }

      if (this.state.phase === "MEETING" && this.state.activeMeeting) {
        if (nextNowMs >= this.state.activeMeeting.endsAtMs) this.resolveMeeting(nextNowMs);
        return this.getSnapshot();
      }

      if (this.state.phase === "ACTIVE") {
        this.state.activeElapsedMs += deltaMs;
        const remainingMs = this.state.matchDurationMs - this.state.activeElapsedMs;

        if (!this.state.showdownActive && (remainingMs <= 120000 || this.state.zone.currentRadiusMeters <= 75)) {
          this.state.showdownActive = true;
          this.state.nextRevealAtActiveMs = Math.min(this.state.nextRevealAtActiveMs, this.state.activeElapsedMs + 15000);
          this.pushEvent("SHOWDOWN", "🔥🚨 الخاتمة السخنة بدأت! الرادار هيضرب كل 45 ثانية وتهدئة التفنيش قلت للنص!", nextNowMs);
        }

        const living = this.getLivingPlayers();
        for (const p of living) {
          if (p.speedMps < 0.35) {
            p.stationarySeconds += deltaSec;
            p.totalStationarySec = (p.totalStationarySec || 0) + deltaSec;
          } else {
            p.stationarySeconds = 0;
          }
          if (nextNowMs - p.lastTelemetryAtMs > 4000) p.speedMps = 0;
        }

        for (let i = 0; i < living.length; i++) {
          for (let j = i + 1; j < living.length; j++) {
            const d = distanceMeters(living[i].coords, living[j].coords);
            if (d <= 12) {
              const place = getNearbyPlaceLabel(living[i].coords, this.state.pois);
              const dup = this.state.recentEncounters.some((e) => e.place === place && nextNowMs - e.atMs < 30000);
              if (!dup) {
                this.state.recentEncounters.push({ place, atMs: nextNowMs });
                if (this.state.recentEncounters.length > 8) this.state.recentEncounters.shift();
              }
            }
          }
        }

        if (this.state.decoyPing && nextNowMs >= this.state.decoyPing.expiresAtMs) this.state.decoyPing = null;

        if (this.state.activeAirdrop && nextNowMs >= this.state.activeAirdrop.expiresAtMs) {
          this.state.activeAirdrop = null;
          this.pushEvent("AIRDROP_EXPIRED", "💼 شنطة الإمداد اختفت عشان محدش لحقها!", nextNowMs);
        }
        if (!this.state.activeAirdrop && this.state.activeElapsedMs >= this.state.nextAirdropAtActiveMs) {
          this.spawnAirdrop(nextNowMs);
          this.state.nextAirdropAtActiveMs = this.state.activeElapsedMs + C.AIRDROP_INTERVAL_MS;
        }

        if (this.state.revealEndsAtMs > 0 && nextNowMs >= this.state.revealEndsAtMs) {
          this.state.revealEndsAtMs = 0;
          for (const p of Object.values(this.state.players)) p.stealthActiveInCurrentReveal = false;
          this.pushEvent("REVEAL_ENDED", "قفل الرادار — الكل رجع مستخبي تاني.", nextNowMs);
        }
        if (this.state.activeElapsedMs >= this.state.nextRevealAtActiveMs) {
          const dur = this.state.showdownActive ? C.SHOWDOWN_REVEAL_DURATION_MS : C.REVEAL_DURATION_MS;
          const interval = this.state.showdownActive ? C.SHOWDOWN_REVEAL_INTERVAL_MS : C.REVEAL_INTERVAL_MS;
          if (this.state.aiJammedUntilMs <= nextNowMs) {
            this.triggerLocationReveal(nextNowMs, dur);
          }
          this.state.nextRevealAtActiveMs = this.state.activeElapsedMs + interval;
        }

        if (this.state.activeElapsedMs >= this.state.zone.nextShrinkAtActiveMs) {
          this.shrinkZone(nextNowMs);
          this.state.zone.nextShrinkAtActiveMs += C.ZONE_SHRINK_INTERVAL_MS;
        }

        if (this.state.activeElapsedMs >= 5000) {
          this.evaluateZoneBoundary(nextNowMs);
          if (this.state.phase === "GAME_OVER") return this.getSnapshot();
        }

        if (!this.state.brokerMinute4Triggered && this.state.activeElapsedMs >= C.BROKER_MINUTE_4_MS) {
          this.state.brokerMinute4Triggered = true;
          this.triggerBrokerOffer(4, nextNowMs);
        }
        if (!this.state.brokerMinute8Triggered && this.state.activeElapsedMs >= C.BROKER_MINUTE_8_MS) {
          this.state.brokerMinute8Triggered = true;
          this.triggerBrokerOffer(8, nextNowMs);
        }
        if (this.state.activeBrokerOffer && nextNowMs >= this.state.activeBrokerOffer.expiresAtMs) {
          this.state.activeBrokerOffer = null;
        }

        for (const list of Object.values(this.state.missions)) {
          for (const m of list) {
            if (m.status === "in_progress" && m.deadlineMs !== null && nextNowMs > m.deadlineMs) {
              m.status = "expired";
            }
          }
        }

        if (this.state.activeElapsedMs >= this.state.matchDurationMs) {
          const invAlive = this.getLivingPlayers().filter((p) => p.role === "INVESTIGATOR");
          if (invAlive.length > 0) {
            this.endMatch("INVESTIGATORS", "الوقت خلص والمفتشين لسه صامدين! عاش يا أبطال! 🏆", nextNowMs);
          } else {
            this.endMatch("IMPOSTERS", "الوقت خلص والغدّارين سيطروا على الحي! 😈🔪", nextNowMs);
          }
        }
      }
      return this.getSnapshot();
    }

    consumeAiReportSlot() {
      if (this.state.phase !== "ACTIVE") return false;
      if (this.state.aiJammedUntilMs > this.state.nowMs) return false;
      if (this.state.activeElapsedMs < this.state.nextAiReportAtActiveMs) return false;
      this.state.nextAiReportAtActiveMs = this.state.activeElapsedMs + C.AI_REPORT_INTERVAL_MS;
      return true;
    }

    spawnAirdrop(nowMs = this.state.nowMs) {
      if (this.state.phase !== "ACTIVE") return;
      const coords = randomPointInZone(this.state.zone.center, this.state.zone.currentRadiusMeters, this.rng, 0.65);
      const place = getNearbyPlaceLabel(coords, this.state.pois);
      this.state.activeAirdrop = {
        id: this.nextEventId("drop"),
        coords, place,
        expiresAtMs: nowMs + C.AIRDROP_DURATION_MS,
        rewardPoints: C.AIRDROP_REWARD_POINTS,
      };
      this.pushEvent("AIRDROP_SPAWNED", `💼 شنطة إمداد ذهبية نزلت ${place}! أول واحد يوصلها هياخد +${C.AIRDROP_REWARD_POINTS}ن!`, nowMs);
    }

    claimAirdrop(playerId, nowMs = this.state.nowMs) {
      const drop = this.state.activeAirdrop;
      if (!drop || nowMs > drop.expiresAtMs) return { ok: false, error: "شنطة الإمداد اختفت خلاص!" };
      const p = this.state.players[playerId];
      if (!p || !p.alive) return { ok: false, error: "مش متاح" };
      const dist = distanceMeters(p.coords, drop.coords);
      if (dist > C.AIRDROP_CLAIM_RANGE_M + 5) {
        return { ok: false, error: `قرّب من الشنطة الأول (${Math.round(dist)}م — لازم ضمن ${C.AIRDROP_CLAIM_RANGE_M}م)` };
      }
      p.points += drop.rewardPoints;
      if (p.role === "INVESTIGATOR") {
        p.protectedUntilMs = Math.max(p.protectedUntilMs, nowMs + 12000);
      } else {
        // For Imposter, claiming airdrop shaves 20s off kill cooldown instead of a useless shield!
        p.killCooldownUntilMs = Math.max(nowMs, p.killCooldownUntilMs - 20000);
      }
      p.airdropsClaimed = (p.airdropsClaimed || 0) + 1;
      this.state.activeAirdrop = null;
      this.pushEvent("AIRDROP_CLAIMED", `💼🔥 في لاعب لقط شنطة الإمداد الذهبية ${drop.place} وطار بيها!`, nowMs, playerId);
      const bonusMsg = p.role === "IMPOSTER"
        ? `💼🔥 لقطّت الشنطة (+${drop.rewardPoints}ن وتقليل التهدئة 20ث)!`
        : `💼🔥 لقطّت الشنطة (+${drop.rewardPoints}ن + درع حماية 12ث)!`;
      return { ok: true, toast: bonusMsg };
    }

    triggerLocationReveal(nowMs = this.state.nowMs, durMs = C.REVEAL_DURATION_MS) {
      if (this.state.phase !== "ACTIVE") return;
      this.state.revealEndsAtMs = nowMs + durMs;
      for (const p of Object.values(this.state.players)) {
        if (p.stealthArmedForNextReveal) {
          p.stealthActiveInCurrentReveal = true;
          p.stealthArmedForNextReveal = false;
        } else {
          p.stealthActiveInCurrentReveal = false;
        }
      }
      this.pushEvent("REVEAL_STARTED", `📡 رادار كشف الأماكن اشتغل! الكل مكشوف ع الخريطة لمدة ${Math.round(durMs / 1000)} ثانية!`, nowMs);
    }

    shrinkZone(nowMs = this.state.nowMs) {
      this.state.zone.center = this.state.zone.nextCenter;
      this.state.zone.currentRadiusMeters = this.state.zone.nextRadiusMeters;
      this.state.zone.shrinkCount += 1;
      this.state.zone.nextCenter = this.computeNextZoneCenter(this.state.zone.center, this.state.zone.currentRadiusMeters);
      this.state.zone.nextRadiusMeters = Math.max(30, Math.round(this.state.zone.currentRadiusMeters * C.ZONE_SHRINK_FACTOR));
      this.pushEvent("ZONE_SHRUNK", `⭕ الزون قفلت 25%! دلوقتي نص القطر ${this.state.zone.currentRadiusMeters}م — ادخل الدايرة بسرعة!`, nowMs);
    }

    evaluateZoneBoundary(nowMs) {
      let someoneEliminated = false;
      for (const player of this.getLivingPlayers()) {
        const inside = isInsideZone(player.coords, this.state.zone.center, this.state.zone.currentRadiusMeters);
        if (inside) {
          player.outsideZoneSinceMs = null;
        } else {
          if (player.outsideZoneSinceMs === null) {
            player.outsideZoneSinceMs = nowMs;
          } else if (nowMs - player.outsideZoneSinceMs > C.OUTSIDE_ZONE_GRACE_MS) {
            player.alive = false;
            player.eliminationReason = "OUTSIDE_ZONE";
            player.eliminatedAtMs = nowMs;
            player.outsideZoneSinceMs = null;
            someoneEliminated = true;
            this.pushEvent("ZONE_ELIMINATION", `💀 الزون كلت ${player.name} عشان فضّل برّه أكتر من 20 ثانية!`, nowMs, player.id);
          }
        }
      }
      if (someoneEliminated) this.checkWinConditions(nowMs);
    }

    updatePlayerLocation(playerId, coords, nowMs = this.state.nowMs) {
      const player = this.state.players[playerId];
      if (!player) return { ok: false, error: "اللاعب مش موجود" };
      const dtSec = Math.max(0.5, (nowMs - (player.lastTelemetryAtMs || nowMs)) / 1000);
      const movedM = distanceMeters(player.coords, coords);
      const speed = movedM / dtSec;
      player.lastCoords = { ...player.coords };
      player.coords = coords;
      player.lastTelemetryAtMs = nowMs;
      player.speedMps = speed;
      if (speed > (player.maxRecentSpeedMps || 0)) player.maxRecentSpeedMps = speed;
      if (speed > (player.peakSpeedMps || 0) && speed < 14) player.peakSpeedMps = speed;
      if (movedM > 2.5) player.stationarySeconds = 0;

      if (this.state.phase === "ACTIVE" && this.state.activeElapsedMs >= 5000 && player.alive) {
        const inside = isInsideZone(coords, this.state.zone.center, this.state.zone.currentRadiusMeters);
        if (inside) player.outsideZoneSinceMs = null;
        else if (player.outsideZoneSinceMs === null) player.outsideZoneSinceMs = nowMs;
      }
      return { ok: true };
    }

    // Shared Stealth Power
    activateStealth(playerId, nowMs = this.state.nowMs) {
      const p = this.state.players[playerId];
      if (!p || !p.alive) return { ok: false, error: "مش متاح دلوقتي" };
      if (p.stealthUsesRemaining <= 0) return { ok: false, error: "استعملت طاقية الإخفاء بتاعتك خلاص!" };
      if (p.stealthArmedForNextReveal) return { ok: false, error: "طاقية الإخفاء متفعلة أصلاً للرادار الجاي!" };
      p.stealthUsesRemaining -= 1;
      p.stealthArmedForNextReveal = true;
      return { ok: true, toast: "👻 تمام! مش هتبان على الخريطة في الكشف الجاي!" };
    }

    // INVESTIGATOR-ONLY POWER: Shield
    activateProtection(playerId, nowMs = this.state.nowMs) {
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "INVESTIGATOR") return { ok: false, error: "درع الحماية للمحققين بس!" };
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "الدرع بيشتغل بعد وقت التشتيت بس" };
      if (p.points < C.PROTECTION_COST) return { ok: false, error: `محتاج ${C.PROTECTION_COST} نقطة` };
      if (p.protectedUntilMs > nowMs) return { ok: false, error: "الدرع شغال عليك دلوقتي أصلاً!" };
      p.points -= C.PROTECTION_COST;
      p.protectedUntilMs = nowMs + C.PROTECTION_DURATION_MS;
      return { ok: true, toast: "🛡️ درع الحماية شغال 15 ثانية — الغدّار ميقدرش يلمسك!" };
    }

    // IMPOSTER-ONLY POWER: Bloodhound Radar (locate nearest Investigator)
    activateBloodhound(playerId) {
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "IMPOSTER") return { ok: false, error: "رادار الصيد للغدّار بس!" };
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "استنى التشتيت يخلص الأول" };
      if (p.points < C.BLOODHOUND_COST) return { ok: false, error: `محتاج ${C.BLOODHOUND_COST} نقطة` };
      const invs = this.getLivingPlayers().filter((x) => x.role === "INVESTIGATOR");
      if (!invs.length) return { ok: false, error: "مفيش صيدات متاحة دلوقتي!" };
      p.points -= C.BLOODHOUND_COST;
      let best = invs[0], bestD = distanceMeters(p.coords, best.coords);
      for (const inv of invs) {
        const d = distanceMeters(p.coords, inv.coords);
        if (d < bestD) { bestD = d; best = inv; }
      }
      const place = getNearbyPlaceLabel(best.coords, this.state.pois);
      const dir = getArabicDirection(p.coords, best.coords);
      return {
        ok: true,
        intelText: `🩸 رادار الصيد: أقرب ضحية (${best.name}) موجود ${place} — على بُعد ${Math.round(bestD)}م ناحية الـ${dir}!`,
      };
    }

    // IMPOSTER-ONLY POWER: Decoy Red Ping
    activateDecoy(playerId, nowMs = this.state.nowMs) {
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "IMPOSTER") return { ok: false, error: "دي قدرة للغدّار بس!" };
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "استنى التشتيت يخلص الأول" };
      if (p.points < C.DECOY_COST) return { ok: false, error: `محتاج ${C.DECOY_COST} نقطة عشان تعمل تشويش` };
      p.points -= C.DECOY_COST;
      const fakeCoords = randomPointInZone(this.state.zone.center, this.state.zone.currentRadiusMeters, this.rng, 0.7);
      this.state.decoyPing = { coords: fakeCoords, expiresAtMs: nowMs + C.DECOY_DURATION_MS };
      this.pushEvent("DECOY", "📡 إشارة حمرا غريبة نورت على الرادار فجأة!", nowMs);
      return { ok: true, toast: "😈 رميت إشارة وهمية تلخبط المحققين 15 ثانية!" };
    }

    // IMPOSTER-ONLY POWER: Plant Fake Rumor into Public AI Feed
    activatePlantRumor(playerId, nowMs = this.state.nowMs) {
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "IMPOSTER") return { ok: false, error: "دي قدرة للغدّار بس!" };
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "استنى التشتيت يخلص الأول" };
      if (p.points < C.PLANT_RUMOR_COST) return { ok: false, error: `محتاج ${C.PLANT_RUMOR_COST} نقطة` };
      p.points -= C.PLANT_RUMOR_COST;
      const myNearest = getNearestPOI(p.coords, this.state.pois);
      const otherPois = (this.state.pois || []).filter((x) => !myNearest || x.id !== myNearest.poi.id);
      const fakePoi = otherPois[Math.floor(this.rng() * otherPois.length)] || (this.state.pois || [])[0];
      const fakeText = fakePoi
        ? `رصدنا حركة مريبة جداً قريب من ${fakePoi.name}.. واحد جري من هناك بسرعة فجأة!`
        : "في حركة سريعة مريبة في الطرف التاني من المنطقة.. خلوا بالكم!";
      this.addAIReport(fakeText, "local", nowMs);
      return { ok: true, toast: "🎭 سرّبت إشاعة مضللة للمحلل عشان تبعدهم عنك!" };
    }

    // IMPOSTER-ONLY POWER: AI & Radar Jammer
    activateJammer(playerId, nowMs = this.state.nowMs) {
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "IMPOSTER") return { ok: false, error: "دي قدرة للغدّار بس!" };
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "استنى التشتيت يخلص الأول" };
      if (p.points < C.JAMMER_COST) return { ok: false, error: `محتاج ${C.JAMMER_COST} نقطة لتكتيم المحلل` };
      p.points -= C.JAMMER_COST;
      this.state.aiJammedUntilMs = nowMs + C.JAMMER_DELAY_MS;
      this.state.revealEndsAtMs = 0;
      this.pushEvent("AI_JAMMED", "⚡ تشويش إلكتروني! المحلل النفسي والرادار فصلوا مؤقتاً!", nowMs);
      return { ok: true, toast: "⚡ كتمت المحلل النفسي وفصلت الرادار 75 ثانية! اتصرف براحتك!" };
    }

    // IMPOSTER-ONLY ACTION: Eliminate Target
    attemptKill(imposterId, targetId, nowMs = this.state.nowMs) {
      if (this.state.phase === "SPREAD") return { ok: false, error: "اهدى يا عم لسه في وقت التشتيت!" };
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "التفنيش مقفول دلوقتي" };
      const imp = this.state.players[imposterId];
      const tgt = this.state.players[targetId];
      if (!imp || !tgt || !imp.alive || imp.role !== "IMPOSTER") return { ok: false, error: "مينفعش تفنّش!" };
      if (!tgt.alive || tgt.role === "IMPOSTER") return { ok: false, error: "الهدف مش متاح" };
      if (imp.killCooldownUntilMs > nowMs) {
        const rem = Math.ceil((imp.killCooldownUntilMs - nowMs) / 1000);
        return { ok: false, error: `استنى ${rem} ثانية عشان تفنش!` };
      }
      if (tgt.protectedUntilMs > nowMs) return { ok: false, error: "🛡️ يا خسارة! ده مفعل درع الحماية دلوقتي!" };

      const dist = distanceMeters(imp.coords, tgt.coords);
      const tol = Math.min((imp.coords.accuracyMeters ?? 5) * 0.6, 7);
      const maxD = C.KILL_BASE_DISTANCE_M + tol;
      if (dist > maxD) {
        return { ok: false, error: `لسه بعيد شوية (${Math.round(dist)}م — قرّب منه لـ ${Math.round(maxD)}م)` };
      }

      tgt.alive = false;
      tgt.eliminationReason = "KILLED_BY_IMPOSTER";
      tgt.eliminatedAtMs = nowMs;
      imp.killsCount = (imp.killsCount || 0) + 1;
      const cd = this.state.showdownActive ? C.SHOWDOWN_KILL_COOLDOWN_MS : C.KILL_COOLDOWN_MS;
      imp.killCooldownUntilMs = nowMs + cd;
      this.state.bodies.push({
        id: this.nextEventId("body"),
        victimId: tgt.id, victimName: tgt.name,
        coords: { ...tgt.coords }, createdAtMs: nowMs, reported: false,
      });
      this.pushEvent("KILL", `🔪 في ضحية وقعت في الميدان...`, nowMs, imposterId, targetId);
      this.checkWinConditions(nowMs);
      return { ok: true, toast: `🔪 فنشّت ${tgt.name} بنضافة! امشي طبيعي عشان المحلل ميفضحكش!` };
    }

    reportBody(reporterId, bodyId, nowMs = this.state.nowMs) {
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "مينفعش تبلّغ دلوقتي" };
      const rep = this.state.players[reporterId];
      if (!rep || !rep.alive) return { ok: false, error: "الأحياء بس يقدروا يبلغوا" };
      const body = this.state.bodies.find((b) => b.id === bodyId && !b.reported);
      if (!body) return { ok: false, error: "الجثة اتبلغ عنها خلاص" };
      const dist = distanceMeters(rep.coords, body.coords);
      if (dist > C.REPORT_BODY_DISTANCE_M + 5) {
        return { ok: false, error: `قرّب شوية من الجثة (${Math.round(dist)}م)` };
      }
      body.reported = true;
      const meeting = {
        id: this.nextEventId("mtg"),
        triggeredById: rep.id, triggeredByName: rep.name,
        bodyId: body.id, victimName: body.victimName,
        startedAtMs: nowMs, endsAtMs: nowMs + C.MEETING_DURATION_MS,
        votes: {},
        chat: [
          {
            id: this.nextEventId("chat"),
            senderId: "system",
            senderName: "النظام 🚨",
            text: `${rep.name} لقى جثة ${body.victimName}! مين الغدّار يا رجالة؟ قارنوا تقارير المحلل!`,
            createdAtMs: nowMs,
          }
        ],
        ejectedPlayerId: null, resultSummary: null,
      };
      this.state.activeMeeting = meeting;
      this.state.phase = "MEETING";
      this.pushEvent("BODY_REPORTED", `🚨 ${rep.name} لقى جثة ${body.victimName} وطلب اجتماع طارئ!`, nowMs, rep.id, body.victimId);
      return { ok: true, data: meeting, toast: "🚨 اجتماع طارئ! كله يوقف مكانه!" };
    }

    sendMeetingChat(senderId, text, nowMs = this.state.nowMs) {
      if (this.state.phase !== "MEETING" || !this.state.activeMeeting) return { ok: false, error: "مفيش اجتماع" };
      const s = this.state.players[senderId];
      if (!s || !s.alive) return { ok: false, error: "الميتين مبيتكلموش يا شبح!" };
      const trimmed = (text || "").trim();
      if (!trimmed) return { ok: false, error: "اكتب حاجة الأول" };
      this.state.activeMeeting.chat.push({
        id: this.nextEventId("chat"),
        senderId, senderName: s.name, text: trimmed.slice(0, 220), createdAtMs: nowMs,
      });
      return { ok: true };
    }

    sendPostChat(senderId, text, nowMs = this.state.nowMs) {
      const s = this.state.players[senderId];
      const trimmed = (text || "").trim();
      if (!trimmed) return { ok: false };
      if (!this.state.postChat) this.state.postChat = [];
      this.state.postChat.push({
        id: this.nextEventId("pchat"),
        sender: s ? s.name : "لاعب",
        text: trimmed.slice(0, 220),
        createdAtMs: nowMs,
      });
      return { ok: true };
    }

    castVote(voterId, targetId, nowMs = this.state.nowMs) {
      if (this.state.phase !== "MEETING" || !this.state.activeMeeting) return { ok: false, error: "مفيش تصويت دلوقتي" };
      const v = this.state.players[voterId];
      if (!v || !v.alive) return { ok: false, error: "الأحياء بس بيصوتوا" };
      if (targetId !== "SKIP") {
        const t = this.state.players[targetId];
        if (!t || !t.alive) return { ok: false, error: "اللاعب ده مش متاح" };
      }
      this.state.activeMeeting.votes[voterId] = targetId;
      const livingCount = this.getLivingPlayers().length;
      if (Object.keys(this.state.activeMeeting.votes).length >= livingCount) {
        this.resolveMeeting(nowMs);
      }
      return { ok: true, toast: targetId === "SKIP" ? "تمام — اخترت تخطي التصويت" : "🗳️ صوتك اتسجل!" };
    }

    resolveMeeting(nowMs = this.state.nowMs) {
      const mtg = this.state.activeMeeting;
      if (!mtg) return;
      const counts = {};
      let total = 0;
      for (const c of Object.values(mtg.votes)) { total += 1; counts[c] = (counts[c] ?? 0) + 1; }
      let top = null, topVotes = 0, isTie = false;
      for (const [cand, cnt] of Object.entries(counts)) {
        if (cnt > topVotes) { topVotes = cnt; top = cand; isTie = false; }
        else if (cnt === topVotes) isTie = true;
      }
      if (!isTie && top && top !== "SKIP" && topVotes > total / 2) {
        const ej = this.state.players[top];
        if (ej && ej.alive) {
          ej.alive = false;
          ej.eliminationReason = "EJECTED_IN_MEETING";
          ej.eliminatedAtMs = nowMs;
          mtg.ejectedPlayerId = ej.id;
          const wasImp = ej.role === "IMPOSTER" ? "وفعلاً طلع غدّار! 🎉" : "وللأسف طلع بريء يا عيني! 😬";
          mtg.resultSummary = `تم طرد ${ej.name} بـ ${topVotes} أصوات — ${wasImp}`;
        }
      } else {
        mtg.resultSummary = isTie ? "تعادل في الأصوات — محدش اترمي برّه!" : "مفيش أغلبية — كله رجع للميدان!";
      }
      this.pushEvent("MEETING_ENDED", mtg.resultSummary, nowMs);
      this.state.activeMeeting = null;
      this.state.phase = "ACTIVE";
      this.checkWinConditions(nowMs);
    }

    // INVESTIGATOR-ONLY HIGH-STAKES ACCUSATION
    submitSpokenName(reporterId, accusedId, nowMs = this.state.nowMs) {
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "شغالة أثناء اللعب بس" };
      const rep = this.state.players[reporterId];
      const acc = this.state.players[accusedId];
      if (!rep || !rep.alive || rep.role !== "INVESTIGATOR") return { ok: false, error: "للمحققين الأحياء بس!" };
      if (!acc || !acc.alive || acc.id === rep.id) return { ok: false, error: "اختار لاعب تاني" };
      if (rep.spokenNameCooldownUntilMs > nowMs) {
        const rem = Math.ceil((rep.spokenNameCooldownUntilMs - nowMs) / 1000);
        return { ok: false, error: `استنى ${rem} ثانية قبل ما تتهم حد تاني` };
      }
      rep.spokenNameCooldownUntilMs = nowMs + 60000;
      if (acc.role === "IMPOSTER") {
        acc.alive = false;
        acc.eliminationReason = "CAUGHT_BY_SPOKEN_NAME";
        acc.eliminatedAtMs = nowMs;
        this.pushEvent("SPOKEN_NAME_CHECK", `🔥 قفشة معلمين! ${rep.name} قفش الغدّار ${acc.name} وطيّره!`, nowMs, reporterId, accusedId);
        this.checkWinConditions(nowMs);
        return { ok: true, data: { caught: true, accusedName: acc.name }, toast: `🔥 الله عليك! ${acc.name} طلع الغدّار فعلاً وطار!` };
      }
      // Real penalty for false accusation: -25 pts + 10s red location reveal!
      rep.points = Math.max(0, rep.points - C.SPOKEN_PENALTY_POINTS);
      rep.brokerRedBroadcastUntilMs = Math.max(rep.brokerRedBroadcastUntilMs, nowMs + 10000);
      this.pushEvent("SPOKEN_NAME_CHECK", `😅 ${rep.name} اتهم ${acc.name} بالغلط — مكانه اتكشف 10 ثواني!`, nowMs, reporterId, accusedId);
      return {
        ok: true,
        data: { caught: false, accusedName: acc.name },
        toast: `😅 غلط يا معلم! ${acc.name} بريء — خسرت ${C.SPOKEN_PENALTY_POINTS}ن ومكانك اتكشف 10ث!`,
      };
    }

    // INVESTIGATOR-ONLY POWER: Scan real map landmark
    requestLocationQuestion(playerId, poiIdOrName) {
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "شغال بعد التشتيت بس" };
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "INVESTIGATOR") return { ok: false, error: "مسح المعالم للمحققين بس!" };
      if (p.points < C.LOCATION_QUESTION_COST) return { ok: false, error: `محتاج ${C.LOCATION_QUESTION_COST} نقطة` };
      const poi = (this.state.pois || []).find((x) => x.id === poiIdOrName || x.name === poiIdOrName);
      if (!poi) return { ok: false, error: "المكان ده مش متاح للمسح دلوقتي" };
      p.points -= C.LOCATION_QUESTION_COST;
      const scanRadius = Math.max(60, Math.round(this.state.zone.currentRadiusMeters * 0.35));
      const cnt = this.getLivingPlayers().filter(
        (x) => x.id !== playerId && distanceMeters(x.coords, { lat: poi.lat, lng: poi.lng }) <= scanRadius
      ).length;
      const intelText = cnt > 0
        ? `📡 مسح محيط "${poi.name}": الرادار لقط ${cnt} لاعب(ين) قريبين منه دلوقتي!`
        : `📡 مسح محيط "${poi.name}": فاضي تماماً يا باشا، مفيش حد قريب منه!`;
      return { ok: true, intelText };
    }

    // INVESTIGATOR-ONLY POWER: Bold Hint on Imposter
    requestBoldHint(playerId) {
      if (this.state.phase !== "ACTIVE") return { ok: false, error: "شغال بعد التشتيت بس" };
      const p = this.state.players[playerId];
      if (!p || !p.alive || p.role !== "INVESTIGATOR") return { ok: false, error: "تلميح الغدّار للمحققين بس!" };
      if (p.points < C.BOLD_HINT_COST) return { ok: false, error: `محتاج ${C.BOLD_HINT_COST} نقطة` };
      p.points -= C.BOLD_HINT_COST;
      const imp = this.getLivingPlayers().find((x) => x.role === "IMPOSTER" && x.id !== playerId);
      if (!imp) return { ok: true, intelText: "🔥 مفيش خطر دلوقتي في الميدان!" };
      const place = getNearbyPlaceLabel(imp.coords, this.state.pois);
      const dist = Math.round(distanceMeters(p.coords, imp.coords));
      const dir = getArabicDirection(p.coords, imp.coords);
      const intelText = `🔥 تلميح تقيل من المحلل: الغدّار حالياً ${place}.. وبينه وبينك حوالي ${dist}م! افتح عينك!`;
      return { ok: true, intelText, meta: { place, dist, dir } };
    }

    triggerBrokerOffer(minuteMark, nowMs = this.state.nowMs) {
      if (this.state.phase !== "ACTIVE") return;
      this.state.activeBrokerOffer = {
        id: this.nextEventId("broker"),
        minuteMark, triggeredAtMs: nowMs,
        expiresAtMs: nowMs + C.BROKER_OFFER_WINDOW_MS,
        acceptedByPlayerIds: [],
      };
      this.pushEvent("BROKER_OFFER", `🤝 عرض سمسار سري نزل للكل! معلومة ذهبية أو +${C.BROKER_CASH_REWARD}ن كاش قصاد كشف مكانك 15ث!`, nowMs);
    }

    // ROLE-AWARE BROKER DEAL (Hunter gets nearest Victim; Investigator gets nearest Imposter!)
    acceptBrokerOffer(playerId, choice = "intel", nowMs = this.state.nowMs) {
      const offer = this.state.activeBrokerOffer;
      if (!offer || nowMs > offer.expiresAtMs) return { ok: false, error: "راحت عليك الصفقة.. الوقت خلص!" };
      const p = this.state.players[playerId];
      if (!p || !p.alive) return { ok: false, error: "مش متاح" };
      if (offer.acceptedByPlayerIds.includes(playerId)) return { ok: false, error: "قبلت الصفقة دي خلاص!" };

      offer.acceptedByPlayerIds.push(playerId);
      p.brokerRedBroadcastUntilMs = nowMs + C.BROKER_RED_BROADCAST_MS;
      this.pushEvent("BROKER_ACCEPTED", `🔴 ${p.name} عمل صفقة مع السمسار! مكانه منوّر أحمر ع الخريطة 15 ثانية!`, nowMs, playerId);

      if (choice === "cash") {
        p.points += C.BROKER_CASH_REWARD;
        return {
          ok: true,
          intelText: `💰 صفقة الكاش تمت! خدت +${C.BROKER_CASH_REWARD} نقطة (اجري بقى عشان مكانك مكشوف بالأحمر 15ث!)`,
        };
      }

      const targetRole = p.role === "IMPOSTER" ? "INVESTIGATOR" : "IMPOSTER";
      const targets = this.getLivingPlayers().filter((x) => x.role === targetRole && x.id !== playerId);
      let best = null, nearest = Infinity;
      for (const t of targets) {
        const d = distanceMeters(p.coords, t.coords);
        if (d < nearest) { nearest = d; best = t; }
      }
      if (!best) return { ok: true, intelText: "🤝 صفقة السمسار تمت — مفيش أهداف قريبة دلوقتي!" };
      const dir = getArabicDirection(p.coords, best.coords);
      const place = getNearbyPlaceLabel(best.coords, this.state.pois);
      const label = p.role === "IMPOSTER"
        ? `أقرب صيدة (${best.name}) موجود ${place} على بُعد ${Math.round(nearest)}م ناحية الـ${dir}!`
        : `أقرب غدّار ليك موجود ${place} على بُعد ${Math.round(nearest)}م ناحية الـ${dir}!`;
      return {
        ok: true,
        intelText: `🤝 صفقة السمسار تمت! ${label} (اجري بقى عشان مكانك مكشوف 15ث!)`,
      };
    }

    startMission(playerId, missionId, nowMs = this.state.nowMs) {
      const list = this.state.missions[playerId];
      const p = this.state.players[playerId];
      if (!list || !p || !p.alive) return { ok: false, error: "مش متاح" };
      const m = list.find((x) => x.id === missionId);
      if (!m) return { ok: false, error: "المهمة مش موجودة" };
      if (m.status === "completed") return { ok: false, error: "خلصتها خلاص!" };
      const sec = calculateDynamicMissionSeconds(p.coords, m.poi);
      m.estimatedDurationSec = sec;
      m.status = "in_progress";
      m.startedAtMs = nowMs;
      m.deadlineMs = nowMs + sec * 1000;
      return { ok: true, toast: `🎯 بدأنا "${m.title}"! الخط الأصفر ع الخريطة بيوديك للمكان.` };
    }

    completeMission(playerId, missionId, videoVerified, nowMs = this.state.nowMs) {
      const list = this.state.missions[playerId];
      const p = this.state.players[playerId];
      if (!list || !p || !p.alive) return { ok: false, error: "مش متاح" };
      const m = list.find((x) => x.id === missionId);
      if (!m) return { ok: false, error: "المهمة مش موجودة" };
      if (m.status === "completed") return { ok: false, error: "خلصتها قبل كده" };
      const dist = distanceMeters(p.coords, { lat: m.poi.lat, lng: m.poi.lng });
      if (dist > C.MISSION_RANGE_M + 5) {
        return { ok: false, error: `لسه بعيد عن المكان (${Math.round(dist)}م — قرّب لحد ${C.MISSION_RANGE_M}م)` };
      }
      if (!videoVerified) return { ok: false, error: "لازم تصوّر إثبات بالكاميرا الأول!" };
      m.status = "completed";
      m.completedAtMs = nowMs;
      m.gpsVerified = true;
      m.videoVerified = true;
      p.points += m.rewardPoints;
      p.missionsCompleted += 1;

      if (p.role === "INVESTIGATOR") {
        this.state.investigationDone = (this.state.investigationDone || 0) + 1;
        this.pushEvent("MISSION_COMPLETED", `🔍 شريط التحقيق زاد (${this.state.investigationDone}/${this.state.investigationGoal})!`, nowMs, playerId);
        if (this.state.investigationDone >= this.state.investigationGoal) {
          this.endMatch("INVESTIGATORS", "المفتشين جمعوا كل الأدلة وقفلوا القضية 100%! فوز ساحق! 🏆🔍", nowMs);
        }
        return { ok: true, data: { rewardPoints: m.rewardPoints }, toast: `🔍 عاش يا محقق! كسبت +${m.rewardPoints}ن وزوّدت شريط التحقيق!` };
      }

      return { ok: true, data: { rewardPoints: m.rewardPoints }, toast: `🎭 تمويه نضيف! كسبت +${m.rewardPoints}ن لألاعيبك!` };
    }

    addAIReport(summaryText, source, nowMs = this.state.nowMs) {
      const report = { id: this.nextEventId("ai"), createdAtMs: nowMs, summaryText, source };
      this.state.aiReports.push(report);
      this.pushEvent("AI_REPORT", `🤖 المحلل: ${summaryText}`, nowMs);
      return report;
    }

    setAIMatchRecap(text) {
      this.state.aiMatchRecap = text;
    }

    buildAnonymizedSummaryForAI() {
      const placeCounts = {};
      const living = this.getLivingPlayers();
      let sprinterPlace = null;
      let camperPlace = null;
      for (const p of living) {
        const pl = getNearbyPlaceLabel(p.coords, this.state.pois);
        placeCounts[pl] = (placeCounts[pl] ?? 0) + 1;
        if (p.maxRecentSpeedMps > 3.0) {
          sprinterPlace = pl;
          p.maxRecentSpeedMps = 0;
        }
        if (p.stationarySeconds >= 25) camperPlace = pl;
      }
      const recentEnc = this.state.recentEncounters.filter((e) => this.state.nowMs - e.atMs < 90000);
      return {
        activeSeconds: Math.round(this.state.activeElapsedMs / 1000),
        livingCount: living.length,
        placeCounts,
        bodiesCount: this.state.bodies.length,
        zoneRadiusMeters: this.state.zone.currentRadiusMeters,
        showdownActive: this.state.showdownActive,
        sprinterPlace,
        camperPlace,
        encounterPlace: recentEnc.length ? recentEnc[recentEnc.length - 1].place : null,
      };
    }

    computeAwards() {
      const all = Object.values(this.state.players);
      if (!all.length) return [];
      const awards = [];
      const topKiller = [...all].sort((a, b) => (b.killsCount || 0) - (a.killsCount || 0))[0];
      if (topKiller && topKiller.killsCount > 0) {
        awards.push({ icon: "🔪", title: "سفاح الحي", player: topKiller.name, stat: `${topKiller.killsCount} تفنيش` });
      }
      const topMissions = [...all].sort((a, b) => (b.missionsCompleted || 0) - (a.missionsCompleted || 0))[0];
      if (topMissions && topMissions.missionsCompleted > 0) {
        awards.push({ icon: "🎯", title: "شقيان المهام", player: topMissions.name, stat: `${topMissions.missionsCompleted} مهام` });
      }
      const topCamper = [...all].sort((a, b) => (b.totalStationarySec || 0) - (a.totalStationarySec || 0))[0];
      if (topCamper && topCamper.totalStationarySec >= 10) {
        awards.push({ icon: "⛺", title: "ملك الكمبرة", player: topCamper.name, stat: `${Math.round(topCamper.totalStationarySec)}ث واقف` });
      }
      const topRunner = [...all].sort((a, b) => (b.peakSpeedMps || 0) - (a.peakSpeedMps || 0))[0];
      if (topRunner && topRunner.peakSpeedMps > 0.5) {
        awards.push({ icon: "🏃", title: "صاروخ الشارع", player: topRunner.name, stat: `${(topRunner.peakSpeedMps * 3.6).toFixed(1)} كم/س` });
      }
      return awards.slice(0, 4);
    }

    checkWinConditions(nowMs) {
      if (this.state.phase !== "ACTIVE") return;
      const living = this.getLivingPlayers();
      const imps = living.filter((p) => p.role === "IMPOSTER");
      const invs = living.filter((p) => p.role === "INVESTIGATOR");
      if (imps.length === 0) {
        this.endMatch("INVESTIGATORS", "المعلمين خلّصوا على الغدّارين كلهم! فوز ساحق للمفتشين! 🎉", nowMs);
      } else if (invs.length === 0) {
        this.endMatch("IMPOSTERS", "الغدّارين صفّوا كل المفتشين وكسبوا الميدان! 😈🔪", nowMs);
      } else if (invs.length === 1 && !this.state.showdownActive) {
        this.state.showdownActive = true;
        this.pushEvent("SHOWDOWN", "🔥 آخر مفتش فاضل في الميدان! يا يصمد لآخر الوقت يا الغدّار يخلّص الجيم!", nowMs);
      }
    }

    endMatch(winner, reason, nowMs) {
      if (this.state.phase === "GAME_OVER") return;
      this.state.phase = "GAME_OVER";
      this.state.winner = winner;
      this.state.winReason = reason;
      this.state.activeMeeting = null;
      this.state.activeBrokerOffer = null;
      this.pushEvent("GAME_OVER", reason, nowMs);
    }
  }

  function moveTowards(from, to, stepMeters) {
    const d = distanceMeters(from, to);
    if (d <= stepMeters || d === 0) return { ...to, accuracyMeters: 5 };
    const ratio = stepMeters / d;
    return {
      lat: from.lat + (to.lat - from.lat) * ratio,
      lng: from.lng + (to.lng - from.lng) * ratio,
      accuracyMeters: 5,
    };
  }

  function stepBots(engine, stepMeters = 3.8) {
    const snap = engine.getSnapshot();
    const nowMs = snap.nowMs;
    if (snap.phase === "GAME_OVER") return;

    if (snap.phase === "MEETING" && snap.activeMeeting) {
      const living = Object.values(snap.players).filter((p) => p.alive);
      const bots = living.filter((p) => p.isBot);
      for (const bot of bots) {
        const spoke = snap.activeMeeting.chat.some((c) => c.senderId === bot.id);
        if (!spoke && Math.random() < 0.3) {
          const line = K.BOT_SLANG_LINES[Math.floor(Math.random() * K.BOT_SLANG_LINES.length)];
          engine.sendMeetingChat(bot.id, line, nowMs);
        }
        if (snap.activeMeeting.votes[bot.id]) continue;
        if (nowMs - snap.activeMeeting.startedAtMs < 6000) continue;
        if (Math.random() < 0.35) {
          const cands = living.filter((p) => p.id !== bot.id);
          const pick = !cands.length || Math.random() < 0.42 ? "SKIP" : cands[Math.floor(Math.random() * cands.length)].id;
          engine.castVote(bot.id, pick, nowMs);
        }
      }
      return;
    }

    const bots = Object.values(snap.players).filter((p) => p.alive && p.isBot);
    for (const bot of bots) {
      if (!isInsideZone(bot.coords, snap.zone.center, snap.zone.currentRadiusMeters * 0.8)) {
        engine.updatePlayerLocation(bot.id, moveTowards(bot.coords, snap.zone.center, stepMeters * 1.4), nowMs);
        continue;
      }

      if (snap.phase === "SPREAD") {
        const idx = bot.botIndex || 1;
        const angle = ((idx * 137.5) % 360) * (Math.PI / 180);
        const targetDist = snap.zone.currentRadiusMeters * (0.42 + ((idx % 3) * 0.12));
        const target = offsetCoordinates(snap.zone.center, Math.cos(angle) * targetDist, Math.sin(angle) * targetDist);
        engine.updatePlayerLocation(bot.id, moveTowards(bot.coords, target, stepMeters), nowMs);
        continue;
      }

      if (bot.role === "INVESTIGATOR") {
        const nearbyBody = snap.bodies.find((b) => !b.reported && distanceMeters(bot.coords, b.coords) <= 16);
        if (nearbyBody) {
          engine.reportBody(bot.id, nearbyBody.id, nowMs);
          return;
        }
      }

      if (bot.role === "IMPOSTER" && snap.activeElapsedMs >= C.ACTIVE_START_GRACE_MS && bot.killCooldownUntilMs <= nowMs) {
        const invs = Object.values(snap.players).filter((p) => p.alive && p.role === "INVESTIGATOR");
        let nearest = invs[0], minDist = nearest ? distanceMeters(bot.coords, nearest.coords) : Infinity;
        for (const inv of invs) {
          const d = distanceMeters(bot.coords, inv.coords);
          if (d < minDist) { minDist = d; nearest = inv; }
        }
        if (nearest) {
          if (minDist <= 8) { engine.attemptKill(bot.id, nearest.id, nowMs); continue; }
          if (minDist <= 48) { engine.updatePlayerLocation(bot.id, moveTowards(bot.coords, nearest.coords, stepMeters * 1.05), nowMs); continue; }
        }
      }

      if (snap.activeAirdrop && distanceMeters(bot.coords, snap.activeAirdrop.coords) <= 60) {
        if (distanceMeters(bot.coords, snap.activeAirdrop.coords) <= C.AIRDROP_CLAIM_RANGE_M) {
          engine.claimAirdrop(bot.id, nowMs);
        } else {
          engine.updatePlayerLocation(bot.id, moveTowards(bot.coords, snap.activeAirdrop.coords, stepMeters * 1.1), nowMs);
        }
        continue;
      }

      const missions = snap.missions[bot.id] ?? [];
      const act = missions.find((m) => m.status === "in_progress" || m.status === "pending");
      if (act) {
        if (act.status === "pending") engine.startMission(bot.id, act.id, nowMs);
        const poiC = { lat: act.poi.lat, lng: act.poi.lng };
        if (distanceMeters(bot.coords, poiC) <= 18) engine.completeMission(bot.id, act.id, true, nowMs);
        else engine.updatePlayerLocation(bot.id, moveTowards(bot.coords, poiC, stepMeters), nowMs);
      }
    }
  }

  K.Geo = {
    distanceMeters,
    isInsideZone,
    getArabicDirection,
    getNearestPOI,
    getNearbyPlaceLabel,
    offsetCoordinates,
    createSeededRng,
    randomPointInZone,
    generateFallbackPOIs,
  };
  K.KameenEngine = KameenEngine;
  K.stepBots = stepBots;
})(window.Kameen);
