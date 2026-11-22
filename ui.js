"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const esc = K.escHtml;
  const fmt = K.fmtClock;

  function setHtmlIfChanged(el, html) {
    if (!el) return;
    if (el.__lastHtml === html) return;
    el.__lastHtml = html;
    el.innerHTML = html;
  }

  // Crisp 2px stroke vector icons (Zero emoji spam!)
  const ICONS = {
    back: `<svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>`,
    sliders: `<svg viewBox="0 0 24 24"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></svg>`,
    menu: `<svg viewBox="0 0 24 24"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    share: `<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>`,
    copy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    play: `<svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    book: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    user: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    eye: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    target: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>`,
    compass: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
    radar: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="12" x2="18.5" y2="5.5"/></svg>`,
    shield: `<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    bolt: `<svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    cpu: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/></svg>`,
    flag: `<svg viewBox="0 0 24 24"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`,
    close: `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  };

  function avatarBadge(name) {
    const clean = String(name || "X").trim();
    const letter = clean.charAt(0) || "X";
    return `<div class="avatar-dot" style="background:${K.getAvatarColor(clean)};">${esc(letter)}</div>`;
  }

  function formatRevealLabel(sec) {
    const s = Number(sec || 120);
    if (s < 60) return `${s} ثانية`;
    const m = Math.round(s / 60);
    if (m === 1) return "دقيقة";
    if (m === 2) return "دقيقتين";
    return `${m} دقائق`;
  }

  function formatGpsPillHtml() {
    const st = K.state;
    if (!st.gps.accuracy) {
      return `<span class="pill pill-amber tnum">جاري تحديد الموقع</span>`;
    }
    const a = Number(st.gps.accuracy);
    const lbl = a < 10 ? a.toFixed(1) : Math.round(a);
    const cls = a <= 5 ? "pill-green" : (a <= 14 ? "pill-cyan" : "pill-amber");
    return `<span class="pill ${cls} tnum">GPS ±${lbl}م</span>`;
  }

  function updateGpsStatusDOM() {
    const el = document.getElementById("header-gps-pill");
    if (el) el.innerHTML = formatGpsPillHtml();
    const sub = document.getElementById("create-gps-sub");
    if (sub && K.state.gps.accuracy) {
      const a = Number(K.state.gps.accuracy);
      sub.textContent = `دقة الموقع ±${a < 10 ? a.toFixed(1) : Math.round(a)}م • اضغط لتحريك الزون`;
    }
  }

  function renderAppHeader() {
    const st = K.state;
    const hdr = document.getElementById("app-header");
    if (!hdr) return;

    if (st.route === "permissions_gate") {
      hdr.classList.add("hidden");
      return;
    }
    hdr.classList.remove("hidden");

    if (st.route === "landing" || st.route === "howto" || st.route === "profile") {
      hdr.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-sm" alt="كمين" />
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:7px;">
              <span style="font-size:16px;font-weight:900;letter-spacing:0.3px;">كمين</span>
              <span class="ver-pill">${K.CONFIG.VERSION}</span>
            </div>
            <div id="header-gps-pill" style="margin-top:2px;">${formatGpsPillHtml()}</div>
          </div>
        </div>
        <button class="icon-btn" aria-label="الإعدادات" onclick="onOpenModal('game_settings')">${ICONS.menu}</button>
      `;
    } else if (st.route === "lobby" && st.lobby) {
      hdr.innerHTML = `
        <button class="icon-btn" aria-label="رجوع" onclick="onLeaveLobby()">${ICONS.back}</button>
        <div style="text-align:center;min-width:0;">
          <div class="eyebrow">ZONE</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
            <span style="font-size:19px;font-weight:900;letter-spacing:2px;" class="tnum">${esc(st.lobby.code)}</span>
            <button style="border:none;background:none;color:var(--muted);cursor:pointer;padding:2px;display:inline-flex;" onclick="onCopyInviteCode()" title="نسخ الكود">${ICONS.copy}</button>
            <span class="ver-pill">${K.CONFIG.VERSION}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="icon-btn accent-icon" aria-label="مشاركة" onclick="onShareWhatsApp()">${ICONS.share}</button>
          <button class="icon-btn" aria-label="إعدادات اللعبة" onclick="onOpenModal('game_settings')">${ICONS.sliders}</button>
        </div>
      `;
    } else if (st.route === "meeting" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const m = vis.activeMeeting;
      const rem = m ? Math.max(0, Math.ceil((m.endsAtMs - vis.nowMs) / 1000)) : 0;
      hdr.innerHTML = `
        <span class="pill pill-red">اجتماع طارئ</span>
        <div style="font-weight:900;font-size:14px;">التصويت على الغدّار</div>
        <span id="meeting-timer-badge" class="pill pill-red tnum" style="font-size:13px;">${rem}ث</span>
      `;
    } else if (st.route === "result") {
      hdr.innerHTML = `
        <button class="icon-btn" onclick="exitGameToLanding()">${ICONS.back}</button>
        <div style="font-weight:900;font-size:15px;">نتيجة الكمين</div>
        <div style="width:40px;"></div>
      `;
    }
  }

  function renderAppTabBar() {
    const st = K.state;
    const bar = document.getElementById("app-tabbar");
    if (!bar) return;
    const showTabs = st.route === "landing" || st.route === "howto" || st.route === "profile";
    bar.classList.toggle("hidden", !showTabs);
    if (!showTabs) return;

    bar.innerHTML = `
      <button class="tab-item ${st.route === "landing" ? "active" : ""}" onclick="onNav('landing')">
        ${ICONS.play}<span>العب</span>
      </button>
      <button class="tab-item ${st.route === "howto" ? "active" : ""}" onclick="onNav('howto')">
        ${ICONS.book}<span>القوانين</span>
      </button>
      <button class="tab-item ${st.route === "profile" ? "active" : ""}" onclick="onNav('profile')">
        ${ICONS.user}<span>حسابي</span>
      </button>
    `;
  }

  function renderSimDpad() {
    const st = K.state;
    const el = document.getElementById("sim-dpad-root");
    if (!el) return;
    const show = st.route === "simulation" && st.simDpadVisible;
    el.classList.toggle("hidden", !show);
    if (!show) return;
    if (el.dataset.ready === "1") return;
    el.dataset.ready = "1";
    el.innerHTML = `
      <div></div>
      <button class="dpad-btn" onclick="onSimNudge(12, 0)">▲</button>
      <div></div>
      <button class="dpad-btn" onclick="onSimNudge(0, 12)">▶</button>
      <button class="dpad-btn" onclick="Kameen.Map.recenter()">◎</button>
      <button class="dpad-btn" onclick="onSimNudge(0, -12)">◀</button>
      <div></div>
      <button class="dpad-btn" onclick="onSimNudge(-12, 0)">▼</button>
      <div></div>
    `;
  }

  // Pick ONLY the #1 highest-priority alert line so HUD NEVER overflows or overlaps!
  function buildSinglePriorityTicker(vis, st, C, activeMission, activeDist, brokerActive, brokerRem, drop, dropDist, dropCanClaim) {
    if (st.gps.anchorCalibrating) {
      return `
        <div class="hud-ticker amber">
          <span>اضغط على مكانك الحقيقي على الرادار لتصحيح الترحيل</span>
          <button class="btn btn-outline btn-xs" onclick="onCancelAnchorCalibration()">إلغاء</button>
        </div>
      `;
    }
    if (vis.outsideZoneRemainingMs !== null) {
      return `
        <div class="hud-ticker danger">
          <span>أنت خارج الزون — ادخل خلال <b class="tnum">${Math.ceil(vis.outsideZoneRemainingMs / 1000)}ث</b></span>
        </div>
      `;
    }
    if (vis.dangerSense) {
      return `
        <div class="hud-ticker ${vis.dangerSense.level === "critical" ? "danger" : ""}">
          <span>${esc(vis.dangerSense.label)}</span>
        </div>
      `;
    }
    if (vis.phase === "SPREAD") {
      return `
        <div class="hud-ticker amber">
          <span>مرحلة التشتيت — تفرّقوا في المنطقة قبل بدء اللعب</span>
          <span class="tnum">${fmt(vis.spreadRemainingMs)}</span>
        </div>
      `;
    }
    if (brokerActive) {
      return `
        <div class="hud-ticker amber" style="cursor:pointer;" onclick="onOpenModal('broker')">
          <span>صفقة سمسار سرية متاحة (${brokerRem}ث)</span>
          <span class="pill pill-amber">فتح</span>
        </div>
      `;
    }
    if (drop) {
      return `
        <div class="hud-ticker amber">
          <span>إمداد ${esc(drop.place)} (${dropDist}م)</span>
          ${dropCanClaim
            ? `<button class="btn btn-warning btn-xs" onclick="onClaimAirdrop()">التقط +45ن</button>`
            : `<span class="tnum" style="color:var(--muted);">${Math.ceil((drop.expiresAtMs - vis.nowMs) / 1000)}ث</span>`}
        </div>
      `;
    }
    if (vis.aiJammed) {
      return `
        <div class="hud-ticker">
          <span>تشويش إلكتروني نشط — الرادار والمحلل متوقفان</span>
          <span class="tnum">${vis.aiJammedRemainingSec}ث</span>
        </div>
      `;
    }
    if (vis.postSpreadGraceSec > 0) {
      return `
        <div class="hud-ticker">
          <span>فترة الأمان الأولية</span>
          <span class="tnum">${vis.postSpreadGraceSec}ث</span>
        </div>
      `;
    }
    if (activeMission) {
      const insideZ = K.Geo.isInsideZone(vis.self.coords, vis.zone.center, vis.zone.currentRadiusMeters + 15);
      const canProof = activeMission.anywhereInZone ? insideZ : (activeDist <= C.MISSION_RANGE_M + 10);
      const locTxt = activeMission.anywhereInZone ? `${esc(activeMission.title)} • جوه الزون` : `${esc(activeMission.title)} • ${activeDist}م`;
      return `
        <div class="hud-ticker">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${locTxt}</span>
          ${canProof
            ? `<button class="btn btn-success btn-xs" onclick="openCameraForMission('${activeMission.id}')">توثيق AI</button>`
            : `<span style="color:var(--muted);font-size:11px;">${K.Geo.getArabicDirection(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng })}</span>`}
        </div>
      `;
    }
    if (st.lastIntel) {
      return `
        <div class="hud-ticker" style="cursor:pointer;" onclick="onOpenModal('intel_log')">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(st.lastIntel)}</span>
          <button style="border:none;background:none;color:var(--muted);cursor:pointer;font-weight:900;padding:0 4px;" onclick="event.stopPropagation();Kameen.state.lastIntel=null;Kameen.UI.updateHudOnly()">×</button>
        </div>
      `;
    }
    return "";
  }

  // =========================================================================
  // ZERO-OVERLAP MAP / RADAR HUD
  // =========================================================================
  function updateHudOnly() {
    const st = K.state;
    const topEl = document.getElementById("map-hud-top");
    const sideEl = document.getElementById("map-side-fabs");
    const botEl = document.getElementById("map-hud-bottom");
    if (!topEl || !sideEl || !botEl) return;

    renderSimDpad();

    // --- A) CREATE ZONE SCREEN ---
    if (st.route === "create") {
      K.setBodyRoleTheme("neutral");
      K.setDangerVignette(false);
      if (K.isUserTyping() && document.activeElement.id === "create-title-inp") return;
      const f = st.createForm;
      const accTxt = st.gps.accuracy
        ? `دقة الموقع ±${st.gps.accuracy < 10 ? Number(st.gps.accuracy).toFixed(1) : Math.round(st.gps.accuracy)}م • اضغط لتحريك الزون`
        : "جاري تحديد موقعك الحقيقي...";

      setHtmlIfChanged(topEl, `
        <div class="hud-topbar">
          <button class="icon-btn" style="width:36px;height:36px;" onclick="onNav('landing')">${ICONS.back}</button>
          <div style="text-align:center;min-width:0;">
            <div style="font-size:13.5px;font-weight:900;">تحديد منطقة الكمين</div>
            <div id="create-gps-sub" style="font-size:10.5px;color:var(--muted);font-weight:700;">${esc(accTxt)}</div>
          </div>
          <button class="icon-btn" style="width:36px;height:36px;" onclick="onOpenModal('game_settings')">${ICONS.sliders}</button>
        </div>
        ${st.gps.anchorCalibrating ? `
          <div class="hud-ticker amber">
            <span>اضغط على مكانك الحقيقي على الرادار</span>
            <button class="btn btn-outline btn-xs" onclick="onCancelAnchorCalibration()">إلغاء</button>
          </div>
        ` : ""}
      `);

      setHtmlIfChanged(sideEl, `
        <button class="map-fab" title="موقعي" onclick="onUseMyLocationForZone()">${ICONS.target}</button>
        <button class="map-fab" title="نمط الرادار" onclick="Kameen.Map.cycleStyle()">${ICONS.radar}</button>
      `);

      setHtmlIfChanged(botEl, `
        <div class="hud-panel" style="display:flex;flex-direction:column;gap:10px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div class="eyebrow">RADIUS &amp; RADAR PING</div>
              <div id="create-radius-lbl" style="font-size:13px;font-weight:900;">نصف القطر <span style="color:var(--crimson);" class="tnum">${f.radius}م</span> • رصد كل ${formatRevealLabel(f.revealIntervalSec)}</div>
            </div>
            <button class="btn btn-outline btn-xs" onclick="onOpenModal('game_settings')">الإعدادات</button>
          </div>
          <input type="range" min="100" max="800" step="25" value="${f.radius}" style="width:100%;accent-color:var(--crimson);"
            oninput="onRadiusSlide(this.value)"
            onchange="void Kameen.Map.fetchOverpassPOIs(Kameen.state.createForm.center, Kameen.state.createForm.radius)" />
          <button class="btn btn-primary" style="width:100%;padding:13px;" onclick="onCreateMatch()">إنشاء الغرفة ودعوة اللاعبين</button>
        </div>
      `);
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const C = K.GAME_CONSTANTS;
    const isImp = vis.self.role === "IMPOSTER";
    const isSpec = vis.self.role === "SPECTATOR" || !vis.self.alive;
    const isSpread = vis.phase === "SPREAD";

    K.setBodyRoleTheme(isSpec ? "ghost" : (isImp ? "imposter" : "investigator"));
    K.setDangerVignette(Boolean(vis.outsideZoneRemainingMs !== null || vis.showdownActive));

    const activeMission = vis.missions.find((m) => m.status === "in_progress");
    const activeDist = activeMission
      ? Math.round(K.Geo.distanceMeters(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng }))
      : null;

    const nearbyBody = vis.bodies.find((b) => !b.reported && K.Geo.distanceMeters(vis.self.coords, b.coords) <= C.REPORT_BODY_DISTANCE_M + 4);
    const killCdSec = Math.max(0, Math.ceil((vis.self.killCooldownUntilMs - vis.nowMs) / 1000));

    const brokerActive = vis.activeBrokerOffer &&
      vis.nowMs < vis.activeBrokerOffer.expiresAtMs &&
      !isSpec &&
      !vis.activeBrokerOffer.acceptedByPlayerIds.includes(vis.self.id);
    const brokerRem = brokerActive ? Math.ceil((vis.activeBrokerOffer.expiresAtMs - vis.nowMs) / 1000) : 0;

    const drop = vis.activeAirdrop;
    const dropDist = drop ? Math.round(K.Geo.distanceMeters(vis.self.coords, drop.coords)) : null;
    const dropCanClaim = drop && !isSpec && dropDist <= C.AIRDROP_CLAIM_RANGE_M + 5;
    const invPct = Math.min(100, Math.round((vis.investigationDone / Math.max(1, vis.investigationGoal)) * 100));

    // Compact 3-button side rail (ZERO clutter!)
    setHtmlIfChanged(sideEl, `
      <button id="follow-gps-fab" class="map-fab ${st.mapFollowMe ? "active-fab" : ""}" title="تتبع موقعي" onclick="Kameen.Map.recenter()">${ICONS.target}</button>
      <button id="compass-rot-fab" class="map-fab ${st.mapRotateWithMe ? "active-fab" : ""}" title="لف الرادار مع البوصلة" onclick="Kameen.Map.toggleHeadingUp()">${ICONS.compass}</button>
      <button class="map-fab" title="نمط الرادار" onclick="Kameen.Map.cycleStyle()">${ICONS.radar}</button>
      ${st.route === "simulation" ? `<button class="map-fab active-fab" title="أدوات المحاكاة" onclick="onOpenModal('sim_tools')" style="font-size:11px;">SIM</button>` : ""}
    `);

    const pingChip = isSpread
      ? `<span class="pill pill-amber tnum">تشتيت ${fmt(vis.spreadRemainingMs)}</span>`
      : (vis.revealMode === "live" && vis.isRevealActive
          ? `<span class="pill pill-red tnum">لايف ${Math.ceil(vis.revealRemainingMs / 1000)}ث</span>`
          : `<span class="pill tnum">رصد ${fmt(vis.nextRevealInMs)}</span>`);

    const rolePill = isSpec
      ? `<span class="pill">مشاهد</span>`
      : (isImp
          ? `<span class="pill pill-red">غدّار • ${vis.self.points}ن</span>`
          : `<span class="pill pill-cyan">محقق • ${vis.self.points}ن</span>`);

    const tickerHtml = buildSinglePriorityTicker(
      vis, st, C, activeMission, activeDist, brokerActive, brokerRem, drop, dropDist, dropCanClaim
    );

    setHtmlIfChanged(topEl, `
      <div class="hud-topbar" style="flex-direction:column;align-items:stretch;gap:0;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          ${rolePill}
          <div style="display:flex;align-items:center;gap:6px;">
            <span class="tnum" style="font-weight:900;font-size:14px;">${fmt(vis.remainingMatchMs)}</span>
            ${pingChip}
          </div>
          <button class="icon-btn" style="width:34px;height:34px;" aria-label="القائمة والإعدادات" onclick="onOpenModal('game_settings')">${ICONS.menu}</button>
        </div>
        ${!isSpec && !isImp && !isSpread ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px;">
            <span style="font-size:10px;font-weight:800;color:var(--cyan);white-space:nowrap;" class="tnum">كل المحققين ${vis.investigationDone}/${vis.investigationGoal} (${invPct}%)</span>
            <div class="inv-progress-track" style="margin-top:0;"><div class="inv-progress-fill" style="width:${invPct}%;"></div></div>
          </div>
        ` : ""}
      </div>
      ${tickerHtml}
    `);

    // --- SPECTATOR / GHOST DOCK ---
    if (isSpec) {
      setHtmlIfChanged(botEl, `
        <div class="role-dock" style="grid-template-columns:1fr 1fr;">
          <button class="dock-btn primary-dock" onclick="onOpenModal('intel_log')">
            ${ICONS.cpu}<span>سجل المحلل (${vis.aiReports.length})</span>
          </button>
          <button class="dock-btn" onclick="exitGameToLanding()">
            ${ICONS.back}<span>خروج</span>
          </button>
        </div>
      `);
      return;
    }

    // --- IMPOSTER BOTTOM DOCK ---
    if (isImp) {
      const nt = vis.nearestTarget;
      let actionHtml = "";
      if (!isSpread && nt) {
        const canKill = nt.inKillRange && killCdSec === 0;
        const lbl = killCdSec > 0
          ? `تهدئة التفنيش (${killCdSec}ث)`
          : (nt.inKillRange
              ? `إقصاء ${esc(nt.name || "الهدف")} الآن`
              : `أقرب هدف: ${nt.dist}م`);
        actionHtml = `
          <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
            <button class="hero-action-fab tnum"
              style="background:${canKill ? "var(--crimson)" : "#121218"};border-color:${canKill ? "#FF6B7D" : "var(--border-strong)"};"
              ${canKill ? "" : "disabled"}
              onclick="onKillTarget('${nt.id}')">${lbl}</button>
            ${nearbyBody ? `<button class="btn btn-outline btn-sm" onclick="onReportBody('${nearbyBody.id}')">بلاغ تمويه</button>` : ""}
          </div>
        `;
      }
      setHtmlIfChanged(botEl, `
        ${actionHtml}
        <div class="role-dock">
          <button class="dock-btn" onclick="Kameen.Map.recenter()">
            ${ICONS.target}<span>الرادار</span>
          </button>
          <button class="dock-btn" ${isSpread ? "disabled" : ""} onclick="onOpenModal('missions_sheet')">
            ${ICONS.flag}<span>التمويه</span>
            <span class="dock-badge">${vis.missions.filter((m) => m.status === "completed").length}/3</span>
          </button>
          <button class="dock-btn primary-dock" ${isSpread ? "disabled" : ""} onclick="onOpenModal('imposter_powers')">
            ${ICONS.bolt}<span>الألاعيب</span>
            <span class="dock-badge">${vis.self.points}</span>
          </button>
          <button class="dock-btn" onclick="onOpenModal('intel_log')">
            ${ICONS.cpu}<span>المحلل</span>
            ${vis.aiReports.length ? `<span class="dock-badge">${vis.aiReports.length}</span>` : ""}
          </button>
        </div>
      `);
      return;
    }

    // --- INVESTIGATOR BOTTOM DOCK ---
    setHtmlIfChanged(botEl, `
      ${!isSpread && nearbyBody ? `
        <button class="hero-action-fab" style="background:var(--crimson);border-color:#FF6B7D;" onclick="onReportBody('${nearbyBody.id}')">
          إبلاغ عن جثة ${esc(nearbyBody.victimName)} — اجتماع طارئ
        </button>
      ` : ""}
      <div class="role-dock">
        <button class="dock-btn primary-dock" ${isSpread ? "disabled" : ""} onclick="onOpenModal('missions_sheet')">
          ${ICONS.flag}<span>المهام</span>
          <span class="dock-badge">${vis.missions.filter((m) => m.status === "completed").length}/3</span>
        </button>
        <button class="dock-btn" ${isSpread ? "disabled" : ""} onclick="onOpenModal('investigator_powers')">
          ${ICONS.shield}<span>الأدوات</span>
          <span class="dock-badge">${vis.self.points}</span>
        </button>
        <button class="dock-btn" ${isSpread ? "disabled" : ""} onclick="onOpenModal('spoken')">
          ${ICONS.target}<span>اتهام</span>
        </button>
        <button class="dock-btn" onclick="onOpenModal('intel_log')">
          ${ICONS.cpu}<span>المحلل</span>
          ${vis.aiReports.length ? `<span class="dock-badge">${vis.aiReports.length}</span>` : ""}
        </button>
      </div>
    `);
  }

  // =========================================================================
  // NON-MAP PAGES (Permissions Gate / Home / HideZone-Style Lobby / Meeting / Result / Profile / HowTo)
  // =========================================================================
  function renderPage() {
    const st = K.state;
    const root = document.getElementById("page-root");
    if (!root) return;
    K.setBodyRoleTheme("neutral");
    K.setDangerVignette(false);
    renderAppHeader();
    renderAppTabBar();

    // --- 0) FIRST-LAUNCH AUTOMATIC PERMISSIONS GATE ---
    if (st.route === "permissions_gate") {
      root.innerHTML = `
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:12px 0;">
          <div style="text-align:center;">
            <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
            <div class="eyebrow" style="margin-top:12px;color:var(--crimson);">KAMEEN TACTICAL RADAR</div>
            <div style="font-size:24px;font-weight:900;margin-top:2px;">تجهيز الأذونات التلقائي</div>
            <p style="font-size:12.5px;color:var(--muted);font-weight:600;margin:6px 0 0;line-height:1.6;">
              لأعلى دقة موقع وبوصلة ثابتة بدون أي إعدادات يدوية، فعّل الأذونات مرة واحدة فقط.
            </p>
          </div>

          <div class="card" style="display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-size:13px;font-weight:800;">الموقع الدقيق (HyperLock GPS)</div>
                <div style="font-size:11px;color:var(--muted);">لتحديد موقعك بدقة الشارع وتحديث الرادار تلقائياً</div>
              </div>
              <span class="pill ${st.gps.status === "granted" ? "pill-green" : "pill-amber"}">${st.gps.status === "granted" ? "مفعّل" : "مطلوب"}</span>
            </div>
            <div style="height:1px;background:var(--border);"></div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-size:13px;font-weight:800;">البوصلة وحساس الخطوات (PDR)</div>
                <div style="font-size:11px;color:var(--muted);">يشتغلوا تلقائياً لتثبيت الاتجاه وتقليل خطأ الـ GPS</div>
              </div>
              <span class="pill ${st.gps.compassActive || st.gps.motionActive ? "pill-green" : "pill-amber"}">${st.gps.compassActive || st.gps.motionActive ? "مفعّل" : "تلقائي"}</span>
            </div>
            <div style="height:1px;background:var(--border);"></div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div>
                <div style="font-size:13px;font-weight:800;">الكاميرا</div>
                <div style="font-size:11px;color:var(--muted);">لتوثيق المهام الميدانية داخل المنطقة</div>
              </div>
              <span class="pill ${st.camera.status === "granted" ? "pill-green" : ""}">${st.camera.status === "granted" ? "مفعّلة" : "اختياري"}</span>
            </div>
          </div>

          <button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;" onclick="onGrantAllPermissionsAndEnter()">
            تفعيل الأذونات والبدء
          </button>
          <button class="btn btn-muted btn-sm" style="width:100%;" onclick="onSkipPermissionsGate()">
            الدخول الآن وتفعيلها لاحقاً
          </button>
        </div>
      `;
      return;
    }

    // --- 1) HOME SCREEN (Clean HideZone Tactical Aesthetic) ---
    if (st.route === "landing") {
      root.innerHTML = `
        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;border-right:3px solid var(--crimson);">
          <div>
            <div class="eyebrow" style="color:var(--crimson);">GAME MODE: KAMEEN</div>
            <div style="font-size:20px;font-weight:900;margin-top:2px;">مطاردة واقعية بالرادار</div>
            <div style="font-size:12px;color:var(--muted);font-weight:700;margin-top:2px;">فريق واحد • غدّارين عشوائيين • رصد دوري متجدد</div>
          </div>
          <span class="pill sb-status-badge pill-green">جاهز</span>
        </div>

        <div class="card" style="display:flex;flex-direction:column;gap:11px;">
          <div>
            <div class="eyebrow" style="margin-bottom:5px;">اسم اللاعب</div>
            <input id="player-name-input" class="input" type="text" value="${esc(st.user.name)}"
              oninput="Kameen.state.user.name=this.value;try{localStorage.setItem('kameen_name',this.value)}catch{}"
              placeholder="اكتب اسمك..." />
          </div>

          <button class="btn btn-primary" style="width:100%;padding:14px;font-size:14.5px;" onclick="onStartCreateFlow()">
            إنشاء منطقة كمين جديدة
          </button>

          <div style="display:flex;gap:8px;">
            <input id="join-code-input" class="input tnum" type="text" value="${esc(st.joinCode)}"
              oninput="Kameen.state.joinCode=this.value.toUpperCase()"
              onkeydown="if(event.key==='Enter')onJoinByInput()"
              placeholder="كود المنطقة (KMN402)"
              style="flex:1;text-align:center;letter-spacing:2px;text-transform:uppercase;" />
            <button class="btn btn-emerald-outline" style="padding:0 22px;" onclick="onJoinByInput()">انضم</button>
          </div>
        </div>

        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;" onclick="onStartSimulation()">
          <div>
            <div style="font-weight:900;font-size:14px;">تجربة فردية (محاكاة بالبوتات)</div>
            <div style="font-size:11.5px;color:var(--muted);font-weight:600;">اختبر الرادار والدقة ودور الغدّار والمحقق فوراً</div>
          </div>
          <span class="pill pill-red">ابدأ</span>
        </div>

        <button class="btn btn-crimson-outline" style="width:100%;" onclick="onNav('howto')">
          طريقة اللعب والقوانين
        </button>
      `;
      K.Network.updateConnectionBadges();
      return;
    }

    // --- 2) HIDEZONE-STYLE LOBBY (Unified Team + Random Imposters + Spectator Toggle + Sliders Settings!) ---
    if (st.route === "lobby" && st.lobby) {
      const l = st.lobby;
      const isHost = l.hostId === st.user.id;
      const meInLobby = l.players.find((p) => p.id === st.user.id);
      const isSpec = Boolean(meInLobby && meInLobby.isSpectator);
      const activePlayers = l.players.filter((p) => !p.isSpectator);
      const canStart = activePlayers.length >= 3;

      root.innerHTML = `
        <div style="text-align:center;font-size:11.5px;font-weight:900;letter-spacing:0.6px;color:var(--crimson);">
          وضع اللعب: كمين — غدّارين عشوائيين
        </div>

        <div class="hz-stats-card">
          <div class="hz-stat-col">
            <div class="hz-bar red"></div>
            <div>
              <div class="hz-stat-num tnum" style="color:var(--crimson);">${l.imposters}</div>
              <div class="hz-stat-lbl">غدّار عشوائي</div>
            </div>
          </div>
          <div style="font-size:11px;font-weight:900;color:var(--dim);">•</div>
          <div class="hz-stat-col end">
            <div style="text-align:left;">
              <div class="hz-stat-num tnum" style="color:var(--emerald);">${activePlayers.length}</div>
              <div class="hz-stat-lbl">لاعبين • رصد كل ${formatRevealLabel(l.revealIntervalSec)}</div>
            </div>
            <div class="hz-bar green"></div>
          </div>
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 2px 0;">
          <span class="eyebrow">اللاعبون في الغرفة (${l.players.length})</span>
          ${isHost ? `<button class="btn btn-outline btn-xs" onclick="onAddBotToLobby()">+ إضافة بوت</button>` : `<span class="pill sb-status-badge">متصل</span>`}
        </div>

        <div style="display:flex;flex-direction:column;gap:7px;">
          ${l.players.map((p, idx) => `
            <div class="player-row ${p.isSpectator ? "spec-row" : (p.isHost ? "" : "ready-row")}">
              <div style="display:flex;align-items:center;gap:10px;min-width:0;">
                ${avatarBadge(p.name)}
                <div style="min-width:0;">
                  <div style="font-size:13.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</div>
                  <div style="font-size:10.5px;color:var(--muted);font-weight:700;">
                    ${p.isSpectator ? "وضع المشاهد" : (p.isHost ? "قائد الغرفة" : (p.isBot ? "بوت" : "جاهز للعب"))}
                  </div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="ver-pill tnum">${idx + 1}</span>
                ${isHost && !p.isHost ? `<button class="btn btn-outline btn-xs" onclick="onKickLobbyPlayer('${p.id}')">×</button>` : ""}
              </div>
            </div>
          `).join("")}
        </div>

        <button class="btn btn-crimson-outline" style="width:100%;" onclick="onOpenModal('howto_sheet')">
          طريقة اللعب
        </button>

        <div class="toggle-card" onclick="onToggleLobbySpectator()">
          <div style="display:flex;align-items:center;gap:10px;">
            <span style="color:var(--muted);display:inline-flex;">${ICONS.eye}</span>
            <div>
              <div style="font-size:13px;font-weight:800;">وضع المشاهد (Spectator Mode)</div>
              <div style="font-size:11px;color:var(--muted);">متابعة الرادار لايف بدون المشاركة في اللعب</div>
            </div>
          </div>
          <div class="hz-switch ${isSpec ? "on" : ""}"></div>
        </div>

        ${isHost
          ? `<button class="btn ${canStart ? "btn-primary" : "btn-muted"}" style="width:100%;padding:14px;font-size:14.5px;" ${canStart ? "" : "disabled"} onclick="onStartMatchFromLobby()">
              ${canStart ? "بدء الكمين الآن" : "في انتظار اللاعبين (مطلوب 3 لاعبين على الأقل)"}
            </button>`
          : `<div class="card" style="text-align:center;font-size:13px;font-weight:800;color:var(--muted);">في انتظار قائد الغرفة لبدء الجيم...</div>`}
      `;
      K.Network.updateConnectionBadges();
      return;
    }

    // --- 3) EMERGENCY MEETING ---
    if (st.route === "meeting" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const m = vis.activeMeeting;
      if (!m) return;
      root.innerHTML = `
        <div class="card" style="border-right:3px solid var(--crimson);background:#15080B;">
          <div style="font-size:14px;font-weight:900;">${esc(m.triggeredByName)} أبلغ عن جثة ${esc(m.victimName || "لاعب")}</div>
          <div style="font-size:11.5px;color:var(--muted);font-weight:700;">راجعوا تقارير المحلل وصوّتوا لطرد المشتبه به</div>
        </div>

        <div class="card">
          <div class="eyebrow" style="margin-bottom:6px;color:var(--crimson);">تقارير المحلل</div>
          <div id="meeting-intel-feed" style="display:flex;flex-direction:column;gap:6px;max-height:92px;overflow-y:auto;">
            ${buildMeetingIntelHtml(vis)}
          </div>
        </div>

        <div class="card">
          <div class="eyebrow" style="margin-bottom:6px;">المناقشة المباشرة</div>
          <div id="meeting-chat-feed" class="chat-box">${buildMeetingChatHtml(m)}</div>
          ${vis.self.alive ? `
            <div style="display:flex;gap:5px;overflow-x:auto;padding:8px 0;">
              ${K.QUICK_CHAT_LINES.map((q) =>
                `<button class="btn btn-outline btn-xs" style="white-space:nowrap;" onclick="onQuickMeetingChat('${esc(q)}')">${esc(q)}</button>`
              ).join("")}
            </div>
            <div style="display:flex;gap:6px;">
              <input id="meeting-chat-input" class="input" style="padding:9px 12px;font-size:12px;" type="text"
                placeholder="اكتب رسالتك..." onkeydown="if(event.key==='Enter')onSendMeetingChat()" />
              <button class="btn btn-primary btn-sm" onclick="onSendMeetingChat()">إرسال</button>
            </div>
          ` : `<div style="font-size:11px;color:var(--muted);text-align:center;padding-top:6px;">وضع المشاهدة فقط</div>`}
        </div>

        <div class="card">
          <div class="eyebrow" style="margin-bottom:8px;">التصويت</div>
          <div id="meeting-votes-section">${buildMeetingVotesHtml(vis)}</div>
        </div>
      `;
      return;
    }

    // --- 4) MATCH RESULT ---
    if (st.route === "result" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const invWin = vis.winner === "INVESTIGATORS";
      root.innerHTML = `
        <div class="card" style="border-color:${invWin ? "var(--emerald-border)" : "var(--crimson-border)"};background:${invWin ? "#061510" : "#16070A"};text-align:center;padding:22px 16px;">
          <div class="eyebrow" style="color:${invWin ? "var(--emerald)" : "var(--crimson)"};">MATCH OVER</div>
          <div style="font-size:23px;font-weight:900;margin-top:4px;">${invWin ? "فوز المحققين" : "فوز الغدّارين"}</div>
          <div style="font-size:13px;font-weight:700;margin-top:6px;color:var(--muted);">${esc(vis.winReason || "")}</div>
        </div>

        <div id="ai-recap-box" class="intel-item ${vis.aiMatchRecap ? "" : "hidden"}">
          ${vis.aiMatchRecap ? "تعليق المحلل: " + esc(vis.aiMatchRecap) : ""}
        </div>

        ${vis.awards && vis.awards.length ? `
          <div class="card">
            <div class="eyebrow" style="margin-bottom:8px;">ألقاب الجيم</div>
            <div class="grid-2">
              ${vis.awards.map((a) => `
                <div class="award-card">
                  <div style="font-size:12px;font-weight:900;color:var(--amber);">${esc(a.title)}</div>
                  <div style="font-size:13px;font-weight:800;">${esc(a.player)}</div>
                  <div style="font-size:10.5px;color:var(--muted);">${esc(a.stat)}</div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="card">
          <div class="eyebrow" style="margin-bottom:8px;">كشف الأدوار</div>
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${vis.players.filter((p) => !p.isSpectator).map((p) => `
              <div class="player-row ${p.alive ? "" : "dead"}">
                <div style="display:flex;align-items:center;gap:9px;">
                  ${avatarBadge(p.name)}
                  <span style="font-size:13px;font-weight:800;">${esc(p.name)}</span>
                </div>
                <span class="pill ${p.role === "IMPOSTER" ? "pill-red" : "pill-cyan"}">
                  ${p.role === "IMPOSTER" ? "غدّار" : "محقق"} • ${p.alive ? "صامد" : "مُقصى"}
                </span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <div class="eyebrow" style="margin-bottom:8px;">دردشة ما بعد الجيم</div>
          <div id="post-chat-list" class="chat-box" style="margin-bottom:8px;">${buildPostChatHtml(vis.postChat)}</div>
          <div style="display:flex;gap:6px;">
            <input id="post-chat-inp" class="input" style="padding:9px 12px;font-size:12px;" type="text"
              placeholder="اكتب تعليقك..." onkeydown="if(event.key==='Enter')onSendPostChat()" />
            <button class="btn btn-primary btn-sm" onclick="onSendPostChat()">إرسال</button>
          </div>
        </div>

        <div class="grid-2">
          <button class="btn btn-primary" onclick="exitGameToCreate()">جيم جديد</button>
          <button class="btn btn-outline" onclick="exitGameToLanding()">الرئيسية</button>
        </div>
      `;
      return;
    }

    // --- 5) PROFILE ---
    if (st.route === "profile") {
      const u = st.user;
      const rate = u.matchesPlayed ? Math.round((u.matchesWon / u.matchesPlayed) * 100) : 0;
      root.innerHTML = `
        <div class="card" style="text-align:center;">
          <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
          <div style="font-weight:900;font-size:20px;margin-top:8px;">${esc(u.name)}</div>
          <div class="eyebrow" style="margin-top:2px;">FIELD AGENT PROFILE</div>
          <div class="grid-3" style="margin-top:16px;">
            <div class="tele-cell"><div class="tele-val tnum">${u.matchesPlayed}</div><div class="tele-lbl">مباريات</div></div>
            <div class="tele-cell"><div class="tele-val tnum" style="color:var(--emerald);">${rate}%</div><div class="tele-lbl">نسبة الفوز</div></div>
            <div class="tele-cell"><div class="tele-val tnum" style="color:var(--amber);">${u.missionsCompleted}</div><div class="tele-lbl">مهام</div></div>
          </div>
        </div>
      `;
      return;
    }

    // --- 6) HOW TO PLAY ---
    if (st.route === "howto") {
      root.innerHTML = buildHowToHtml();
    }
  }

  function buildHowToHtml() {
    return `
      <div class="card" style="border-right:3px solid var(--crimson);">
        <div class="eyebrow" style="color:var(--crimson);margin-bottom:4px;">فكرة اللعبة</div>
        <div style="font-size:13px;font-weight:700;line-height:1.8;">
          الكل بيدخل في غرفة واحدة، ومع بداية الجيم النظام بيختار الغدّارين عشوائياً والباقي بيكونوا محققين.
          الرادار بيظهر قراءة لمواقع جميع اللاعبين وتتجدد تلقائياً كل دقيقتين (أو حسب التوقيت اللي بتحدده من الإعدادات).
        </div>
      </div>
      <div class="card" style="border-right:3px solid var(--cyan);">
        <div class="eyebrow" style="color:var(--cyan);margin-bottom:4px;">دور المحقق</div>
        <div style="font-size:12.5px;font-weight:700;line-height:1.8;color:var(--muted);">
          • للفوز: لازم <b>كل المحققين الأحياء</b> يخلصوا كل مهامهم الواقعية 100% (بفحص الذكاء الاصطناعي) أو تكشفوا وتطردوا الغدّار قبل ما الوقت يخلص.<br/>
          • استخدم درع الحماية، مسح المعالم، والاتهام المباشر عند التأكد.<br/>
          • نبض القلب بيحذرك تلقائياً لما الغدّار يقرّب منك بدون كشف اسمه.
        </div>
      </div>
      <div class="card" style="border-right:3px solid var(--crimson);">
        <div class="eyebrow" style="color:var(--crimson);margin-bottom:4px;">دور الغدّار</div>
        <div style="font-size:12.5px;font-weight:700;line-height:1.8;color:var(--muted);">
          • صفّي المحققين من مسافة قريبة قبل إغلاق القضية أو كشفك في الاجتماع.<br/>
          • معاك ألاعيب خاصة: رادار الصيد، الإشارة الوهمية، تسريب الإشاعات، والتشويش الإلكتروني لإيقاف الرادار والمحلل.
        </div>
      </div>
    `;
  }

  function buildMissionsCardsHtml(vis) {
    const C = K.GAME_CONSTANTS;
    const isImp = vis.self.role === "IMPOSTER";
    const insideZ = K.Geo.isInsideZone(vis.self.coords, vis.zone.center, vis.zone.currentRadiusMeters + 15);
    const rerollLbl = (vis.self.freeRerollsRemaining || 0) > 0 ? "تبديل (مجاني)" : "تبديل (15ن)";

    return vis.missions.map((m) => {
      const dist = Math.round(K.Geo.distanceMeters(vis.self.coords, { lat: m.poi.lat, lng: m.poi.lng }));
      const dir = K.Geo.getArabicDirection(vis.self.coords, { lat: m.poi.lat, lng: m.poi.lng });
      const canProof = m.anywhereInZone ? insideZ : (dist <= C.MISSION_RANGE_M + 10);
      const proofTypeBadge = m.requiresSpeech
        ? `<span class="pill pill-red">فيديو بالصوت AI</span>`
        : (m.mediaType === "video"
            ? `<span class="pill pill-amber">فيديو AI</span>`
            : `<span class="pill pill-cyan">صورة أو فيديو AI</span>`);
      const locLine = m.anywhereInZone
        ? (insideZ ? "في أي مكان جوه الزون (جاهز للتصوير)" : "ادخل جوه دايرة الزون الأول")
        : `${esc(m.poi.name)} • ${dist}م (${dir})`;

      return `
        <div class="card" style="padding:12px;border-right:3px solid ${m.status === "completed" ? "var(--emerald)" : (m.status === "in_progress" ? "var(--amber)" : "var(--border-strong)")};">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;">
            <div style="font-weight:900;font-size:13.5px;">${esc(m.title)}</div>
            <div style="display:flex;align-items:center;gap:5px;">
              ${proofTypeBadge}
              <span class="pill pill-amber tnum">+${m.rewardPoints}ن</span>
            </div>
          </div>
          <p style="font-size:12px;color:var(--text);font-weight:600;margin:6px 0;line-height:1.55;">${esc(m.description)}</p>
          <div style="font-size:11px;font-weight:800;color:${isImp ? "#FF6B7D" : "var(--cyan)"};margin-bottom:8px;">
            ${locLine}
          </div>
          ${m.status === "completed"
            ? `<div class="pill pill-green" style="width:100%;justify-content:center;padding:7px;">تم الاعتماد بالذكاء الاصطناعي${m.aiNote ? " • " + esc(m.aiNote).slice(0, 38) : ""}</div>`
            : m.status === "pending"
              ? `<div style="display:flex;gap:6px;">
                  <button class="btn ${isImp ? "btn-crimson-outline" : "btn-cyan"} btn-sm" style="flex:1;" onclick="onStartMission('${m.id}')">${m.anywhereInZone ? "ابدأ التحدي الآن" : "ابدأ وافتح المسار"}</button>
                  <button class="btn btn-outline btn-sm" onclick="onRerollMission('${m.id}')">${rerollLbl}</button>
                </div>`
              : `<div style="display:flex;flex-direction:column;gap:6px;">
                  <div class="grid-2">
                    <button class="btn btn-outline btn-sm" onclick="onCloseModal();Kameen.Map.recenter()">عرض الرادار</button>
                    <button class="btn btn-success btn-sm" ${canProof ? "" : "disabled"} onclick="openCameraForMission('${m.id}')">
                      ${canProof ? (m.requiresSpeech ? "صوّر فيديو بالصوت" : "صوّر للتقييم AI") : `اقترب (${dist}م)`}
                    </button>
                  </div>
                  <button class="btn btn-muted btn-xs" style="width:100%;" onclick="onRerollMission('${m.id}')">ملقتش المطلوب؟ ${rerollLbl}</button>
                </div>`
          }
        </div>
      `;
    }).join("");
  }

  function updateMissionsDynamic() {
    if (!K.state.engine || K.state.modal !== "missions_sheet") return;
    const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
    const wrap = document.getElementById("missions-sheet-list");
    if (wrap) wrap.innerHTML = buildMissionsCardsHtml(vis);
  }

  function buildMeetingIntelHtml(vis) {
    if (!vis.aiReports.length) return `<div style="font-size:11.5px;color:var(--muted);">لا توجد تقارير بعد.</div>`;
    return [...vis.aiReports].reverse().map((r) => `<div class="intel-item">${esc(r.summaryText)}</div>`).join("");
  }

  function buildMeetingChatHtml(m) {
    if (!m.chat.length) return `<div style="font-size:11.5px;color:var(--muted);">ابدأ النقاش...</div>`;
    return m.chat.map((c) => `
      <div class="chat-msg">
        <b style="color:${c.senderId === "system" ? "var(--crimson)" : "var(--amber)"};">${esc(c.senderName)}:</b>
        <span>${esc(c.text)}</span>
      </div>
    `).join("");
  }

  function buildMeetingVotesHtml(vis) {
    const m = vis.activeMeeting;
    const myVote = m.votes[vis.self.id];
    const living = vis.players.filter((p) => p.alive);
    return `
      <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:8px;">
        الأصوات المسجلة: ${Object.keys(m.votes).length} / ${living.length} ${myVote ? "• تم تسجيل صوتك" : ""}
      </div>
      <div class="grid-2">
        ${living.map((p) => `
          <button class="btn ${myVote === p.id ? "btn-danger" : "btn-outline"} btn-sm" style="justify-content:flex-start;" ${!vis.self.alive ? "disabled" : ""}
            onclick="onCastVote('${p.id}')">
            ${avatarBadge(p.name)}
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</span>
          </button>
        `).join("")}
      </div>
      <button class="btn ${myVote === "SKIP" ? "btn-warning" : "btn-outline"} btn-sm" style="width:100%;margin-top:8px;" ${!vis.self.alive ? "disabled" : ""}
        onclick="onCastVote('SKIP')">تخطي التصويت</button>
    `;
  }

  function updateMeetingDynamic() {
    if (!K.state.engine) return;
    const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
    const m = vis.activeMeeting;
    if (!m) return;
    const tEl = document.getElementById("meeting-timer-badge");
    if (tEl) tEl.textContent = Math.max(0, Math.ceil((m.endsAtMs - vis.nowMs) / 1000)) + "ث";
    const cEl = document.getElementById("meeting-chat-feed");
    if (cEl && cEl.dataset.len !== String(m.chat.length)) {
      cEl.dataset.len = String(m.chat.length);
      cEl.innerHTML = buildMeetingChatHtml(m);
      cEl.scrollTop = cEl.scrollHeight;
    }
    const vEl = document.getElementById("meeting-votes-section");
    if (vEl) vEl.innerHTML = buildMeetingVotesHtml(vis);
  }

  function buildPostChatHtml(list) {
    if (!list || !list.length) return `<span style="font-size:11.5px;color:var(--muted);">ابدأ الكلام...</span>`;
    return list.map((c) => `<div class="chat-msg"><b style="color:var(--amber);">${esc(c.sender)}:</b> ${esc(c.text)}</div>`).join("");
  }

  function updateResultChatDOM() {
    if (!K.state.engine) return;
    const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
    const el = document.getElementById("post-chat-list");
    if (el) { el.innerHTML = buildPostChatHtml(vis.postChat); el.scrollTop = el.scrollHeight; }
    if (vis.aiMatchRecap) {
      const box = document.getElementById("ai-recap-box");
      if (box) { box.textContent = "تعليق المحلل: " + vis.aiMatchRecap; box.classList.remove("hidden"); }
    }
  }

  function updateCameraModalStatus() {
    const st = K.state;
    const vEl = document.getElementById("cam-verdict-box");
    if (vEl) {
      vEl.textContent = st.videoVerdict || "";
      vEl.classList.toggle("hidden", !st.videoVerdict);
      const tone = st.videoVerdictTone || "pending";
      if (tone === "success") {
        vEl.style.background = "var(--emerald-tint)";
        vEl.style.borderColor = "var(--emerald-border)";
        vEl.style.color = "#34D399";
      } else if (tone === "error") {
        vEl.style.background = "var(--crimson-tint)";
        vEl.style.borderColor = "var(--crimson-border)";
        vEl.style.color = "#FF6B7D";
      } else {
        vEl.style.background = "var(--amber-tint)";
        vEl.style.borderColor = "var(--amber-border)";
        vEl.style.color = "#FCD34D";
      }
    }
    const lbl = document.getElementById("cam-upload-lbl");
    if (lbl) {
      lbl.textContent = st.videoAnalyzing
        ? "الذكاء الاصطناعي بيفحص اللقطة..."
        : (lbl.dataset.defaultLabel || "التقط صورة أو فيديو الآن");
    }
  }

  function bottomSheetHtml(title, bodyHtml, accentColor = "var(--text)") {
    return `
      <div class="sheet-backdrop" onclick="if(event.target===this)onCloseModal()">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:900;font-size:15.5px;color:${accentColor};">${title}</span>
            <button class="icon-btn" style="width:32px;height:32px;" onclick="onCloseModal()">${ICONS.close}</button>
          </div>
          <div class="sheet-body">${bodyHtml}</div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // ☰ UNIFIED GAME SETTINGS DRAWER (Accessible Everywhere via ☰ / Sliders!)
  // =========================================================================
  function buildGameSettingsBody() {
    const st = K.state;
    const inMatch = Boolean(st.engine && (st.route === "game" || st.route === "simulation"));
    const inLobby = Boolean(st.lobby && st.route === "lobby");
    const canEditGameRules = !inMatch
      ? (!inLobby || st.lobby.hostId === st.user.id)
      : K.App.isMatchHost();

    const cfg = inMatch
      ? {
          revealIntervalSec: st.engine.getSnapshot().revealIntervalSec || 120,
          revealMode: st.engine.getSnapshot().revealMode || "ping",
          duration: Math.round(st.engine.getSnapshot().matchDurationMs / 60000),
          spreadSeconds: st.createForm.spreadSeconds,
          imposters: st.createForm.imposters,
          radius: st.engine.getSnapshot().zone.currentRadiusMeters,
        }
      : (inLobby ? st.lobby : st.createForm);

    const t = K.Location.getTelemetry();
    const hasKey = Boolean((st.groqKey || "").trim());
    const canAnchor = st.route === "create" || st.route === "game" || st.route === "simulation";

    return `
      <div class="card" style="display:flex;flex-direction:column;gap:10px;">
        <div class="eyebrow" style="color:var(--crimson);">إعدادات رصد اللاعبين على الرادار</div>
        <div>
          <div style="font-size:11.5px;font-weight:800;margin-bottom:6px;">توقيت تحديث قراءة اللاعبين (كل كام دقيقة):</div>
          <div class="grid-5">
            ${[30, 60, 120, 180, 300].map((sec) => `
              <button class="seg-btn tnum ${cfg.revealIntervalSec === sec ? "active" : ""}" ${canEditGameRules ? "" : "disabled"}
                onclick="onUpdateGameSetting('revealIntervalSec', ${sec})">
                ${sec < 60 ? sec + "ث" : (sec / 60) + "د"}
              </button>
            `).join("")}
          </div>
        </div>
        <div>
          <div style="font-size:11.5px;font-weight:800;margin-bottom:6px;">نمط ظهور اللاعبين:</div>
          <div class="grid-2">
            <button class="seg-btn ${cfg.revealMode !== "live" ? "active" : ""}" ${canEditGameRules ? "" : "disabled"}
              onclick="onUpdateGameSetting('revealMode', 'ping')">قراءة ثابتة تتجدد</button>
            <button class="seg-btn ${cfg.revealMode === "live" ? "active" : ""}" ${canEditGameRules ? "" : "disabled"}
              onclick="onUpdateGameSetting('revealMode', 'live')">تتبع لايف 15ث</button>
          </div>
        </div>
      </div>

      ${!inMatch ? `
        <div class="card" style="display:flex;flex-direction:column;gap:10px;">
          <div class="eyebrow">إعدادات الجيم والزون</div>
          <div class="grid-3">
            <div>
              <div style="font-size:10.5px;color:var(--muted);font-weight:800;margin-bottom:4px;">المدة</div>
              <div class="grid-2" style="gap:4px;">
                ${[10, 15, 20, 30].map((d) => `<button class="seg-btn tnum ${cfg.duration === d ? "active" : ""}" ${canEditGameRules ? "" : "disabled"} onclick="onUpdateGameSetting('duration', ${d})">${d}د</button>`).join("")}
              </div>
            </div>
            <div>
              <div style="font-size:10.5px;color:var(--muted);font-weight:800;margin-bottom:4px;">التشتيت</div>
              <div class="grid-2" style="gap:4px;">
                ${[15, 30, 60, 120].map((s) => `<button class="seg-btn tnum ${cfg.spreadSeconds === s ? "active" : ""}" ${canEditGameRules ? "" : "disabled"} onclick="onUpdateGameSetting('spreadSeconds', ${s})">${s < 60 ? s + "ث" : (s / 60) + "د"}</button>`).join("")}
              </div>
            </div>
            <div>
              <div style="font-size:10.5px;color:var(--muted);font-weight:800;margin-bottom:4px;">الغدّارين</div>
              <div class="grid-3" style="gap:4px;">
                ${[1, 2, 3].map((n) => `<button class="seg-btn tnum ${cfg.imposters === n ? "active" : ""}" ${canEditGameRules ? "" : "disabled"} onclick="onUpdateGameSetting('imposters', ${n})">${n}</button>`).join("")}
              </div>
            </div>
          </div>
        </div>
      ` : ""}

      <div class="card" style="display:flex;flex-direction:column;gap:8px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="eyebrow">نظام الموقع التلقائي (HYPERLOCK 3M)</span>
          <span class="pill pill-green">تلقائي</span>
        </div>
        <div class="tele-grid">
          <div class="tele-cell">
            <div class="tele-lbl">الدقة الحالية</div>
            <div class="tele-val tnum">${t.fusedAcc !== null ? "±" + t.fusedAcc.toFixed(1) + "م" : "جاري المسح"}</div>
          </div>
          <div class="tele-cell">
            <div class="tele-lbl">البوصلة والخطوات</div>
            <div class="tele-val">${t.headingDeg !== null ? Math.round(t.headingDeg) + "° " + esc(t.headingArabic) : "تلقائي"} • ${t.stepsTotal}</div>
          </div>
        </div>
        ${canAnchor ? `
          <div class="grid-2">
            <button class="btn btn-outline btn-xs" onclick="onStartAnchorCalibration()">ضبط مكاني يدوياً</button>
            <button class="btn btn-outline btn-xs" onclick="Kameen.SFX.toggle();Kameen.UI.renderModal()">الصوت: ${K.SFX.muted ? "مكتوم" : "مفعّل"}</button>
          </div>
        ` : `
          <button class="btn btn-outline btn-xs" onclick="Kameen.SFX.toggle();Kameen.UI.renderModal()">الصوت: ${K.SFX.muted ? "مكتوم" : "مفعّل"}</button>
        `}
      </div>

      <div class="card" style="display:flex;flex-direction:column;gap:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="eyebrow">مفتاح الذكاء الاصطناعي (GROQ AI)</span>
          <span class="pill ${hasKey ? "pill-green" : "pill-amber"}">${hasKey ? "متصل" : "غير مضاف"}</span>
        </div>
        <input class="input" style="padding:9px 11px;font-size:12px;direction:ltr;" type="password"
          placeholder="gsk_..."
          value="${esc(st.groqKey)}"
          oninput="Kameen.state.groqKey=this.value;try{localStorage.setItem('kameen_groq_key',this.value)}catch{}" />
      </div>

      ${inMatch ? `
        <button class="btn btn-crimson-outline btn-sm" style="width:100%;" onclick="exitGameToLanding()">مغادرة الجيم والعودة للرئيسية</button>
      ` : ""}
    `;
  }

  function updatePrecisionSheetDynamic() {
    if (K.state.modal !== "game_settings") return;
    // Lightweight: no full re-render while typing in password input
    if (K.isUserTyping()) return;
  }

  // =========================================================================
  // MODALS & SLIDE-UP SHEETS
  // =========================================================================
  function renderModal() {
    const st = K.state;
    const mr = document.getElementById("modal-root");
    if (!mr) return;
    const C = K.GAME_CONSTANTS;

    // 1. Secret Role Reveal Card
    if ((st.route === "game" || st.route === "simulation") && !st.roleRevealed && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      if (vis.self.role === "SPECTATOR") {
        st.roleRevealed = true;
        mr.innerHTML = "";
        return;
      }
      const isImp = vis.self.role === "IMPOSTER";
      mr.innerHTML = `
        <div class="center-modal-backdrop">
          ${!st.roleFlipped ? `
            <div class="card" style="max-width:340px;width:100%;text-align:center;border-color:var(--crimson);">
              <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
              <div class="eyebrow" style="margin-top:10px;color:var(--crimson);">SECRET ROLE</div>
              <div style="font-size:21px;font-weight:900;margin-top:2px;">بطاقة الدور السري</div>
              <p style="font-size:12.5px;color:var(--muted);font-weight:600;">تأكد ألا يرى أحد شاشتك ثم اضغط لكشف دورك</p>
              <button class="btn btn-primary" style="width:100%;margin-top:10px;" onclick="onFlipRoleCard()">كشف الدور</button>
            </div>
          ` : `
            <div class="role-card-glow ${isImp ? "imposter" : "investigator"}" style="max-width:340px;width:100%;">
              <div class="eyebrow" style="color:${isImp ? "var(--crimson)" : "var(--cyan)"};">${isImp ? "IMPOSTER" : "INVESTIGATOR"}</div>
              <div style="font-size:28px;font-weight:900;margin-top:4px;color:${isImp ? "#FF6B7D" : "#7DD3FC"};">
                ${isImp ? "أنت الغدّار" : "أنت المحقق"}
              </div>
              <p style="font-size:12.5px;color:var(--muted);font-weight:600;line-height:1.7;margin:10px 0;">
                ${isImp
                  ? "صفّي المحققين من مسافة قريبة واستخدم التشويش والإشارات الوهمية لتضليلهم."
                  : "أنهِ مهامك لإغلاق القضية 100%، راقب قراءة الرادار وتقارير المحلل، واطرد الغدّار."}
              </p>
              ${vis.imposterPartners.length ? `
                <div class="pill pill-red" style="margin-bottom:10px;">شريكك: ${esc(vis.imposterPartners.map((x) => x.name).join("، "))}</div>
              ` : ""}
              <button class="btn ${isImp ? "btn-primary" : "btn-cyan"}" style="width:100%;margin-top:6px;" onclick="onAcceptRoleCard()">ابدأ التشتيت</button>
            </div>
          `}
        </div>
      `;
      return;
    }

    // 2. Eliminated Modal
    if (st.modal === "eliminated" && st.engine) {
      const self = st.engine.getVisibleStateForPlayer(st.user.id).self;
      const reasonMap = {
        KILLED_BY_IMPOSTER: "تم إقصاؤك بواسطة الغدّار.",
        OUTSIDE_ZONE: "تم إقصاؤك لبقائك خارج الزون.",
        EJECTED_IN_MEETING: "تم التصويت على طردك في الاجتماع.",
        CAUGHT_BY_SPOKEN_NAME: "تم كشفك بالاتهام المباشر.",
      };
      mr.innerHTML = `
        <div class="center-modal-backdrop">
          <div class="card" style="max-width:330px;width:100%;text-align:center;border-color:var(--crimson);">
            <div class="eyebrow" style="color:var(--crimson);">ELIMINATED</div>
            <div style="font-size:22px;font-weight:900;margin-top:4px;">خرجت من الجيم</div>
            <p style="font-size:13px;color:var(--muted);font-weight:700;margin:10px 0;">${reasonMap[self.eliminationReason] || "تم إقصاؤك من الميدان."}</p>
            <button class="btn btn-outline" style="width:100%;" onclick="onCloseModal()">دخول وضع المشاهد</button>
          </div>
        </div>
      `;
      return;
    }

    // 3. Game Settings Drawer (☰ / Sliders)
    if (st.modal === "game_settings") {
      mr.innerHTML = bottomSheetHtml("إعدادات اللعبة والرادار", buildGameSettingsBody());
      return;
    }

    // 4. How-To Sheet (from Lobby)
    if (st.modal === "howto_sheet") {
      mr.innerHTML = bottomSheetHtml("طريقة اللعب", buildHowToHtml());
      return;
    }

    // 5. Missions Sheet
    if (st.modal === "missions_sheet" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isImp = vis.self.role === "IMPOSTER";
      const sub = isImp
        ? `<div style="font-size:11.5px;color:var(--muted);">مهام تمويه اختيارية تمنحك نقاطاً لتشغيل ألاعيبك.</div>`
        : `<div class="card" style="padding:10px;border-color:var(--cyan-border);font-size:11.5px;color:var(--cyan);font-weight:800;">تقدم كل المحققين: <span class="tnum">${vis.investigationDone}/${vis.investigationGoal}</span> مهمة (${vis.investigatorsFinishedCount || 0} من ${vis.investigatorsTotalCount || 1} محققين خلّصوا الكل)</div>`;
      mr.innerHTML = bottomSheetHtml(
        isImp ? "مهام التمويه" : "مهام التحقيق",
        `${sub}<div id="missions-sheet-list" style="display:flex;flex-direction:column;gap:8px;">${buildMissionsCardsHtml(vis)}</div>`,
        isImp ? "#FF6B7D" : "var(--cyan)"
      );
      return;
    }

    // 6. Imposter Powers
    if (st.modal === "imposter_powers" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        <div style="font-size:12px;color:var(--muted);font-weight:800;">رصيدك: <b style="color:var(--amber);" class="tnum">${vis.self.points} نقطة</b></div>
        <button class="power-tile" onclick="onUseAbility('STEALTH')" ${vis.self.stealthUsesRemaining <= 0 ? "disabled" : ""}>
          <div><div style="font-weight:900;font-size:13px;">إخفاء من الرصد القادم</div><div style="font-size:11px;color:var(--muted);">لا يظهر موقعك في قراءة الرادار التالية</div></div>
          <span class="pill pill-green">مجاني (${vis.self.stealthUsesRemaining})</span>
        </button>
        <button class="power-tile" onclick="onUseAbility('BLOODHOUND')">
          <div><div style="font-weight:900;font-size:13px;color:#FF6B7D;">رادار الصيد</div><div style="font-size:11px;color:var(--muted);">يكشف اتجاه ومسافة أقرب محقق</div></div>
          <span class="pill pill-red tnum">${C.BLOODHOUND_COST}ن</span>
        </button>
        <button class="power-tile" onclick="onUseAbility('PLANT_RUMOR')">
          <div><div style="font-weight:900;font-size:13px;">تسريب إشاعة مضللة</div><div style="font-size:11px;color:var(--muted);">إرسال تقرير وهمي للجميع لتشتيتهم</div></div>
          <span class="pill pill-amber tnum">${C.PLANT_RUMOR_COST}ن</span>
        </button>
        <button class="power-tile" onclick="onUseAbility('DECOY')">
          <div><div style="font-weight:900;font-size:13px;">إشارة حمراء وهمية</div><div style="font-size:11px;color:var(--muted);">وضع نقطة تضليل على الرادار 15 ثانية</div></div>
          <span class="pill pill-red tnum">${C.DECOY_COST}ن</span>
        </button>
        <button class="power-tile" style="border-color:var(--crimson-border);" onclick="onUseAbility('JAMMER')">
          <div><div style="font-weight:900;font-size:13px;color:#FF6B7D;">تشويش إلكتروني</div><div style="font-size:11px;color:var(--muted);">إيقاف الرادار والمحلل 75 ثانية</div></div>
          <span class="pill pill-red tnum">${C.JAMMER_COST}ن</span>
        </button>
      `;
      mr.innerHTML = bottomSheetHtml("ألاعيب الغدّار", body, "#FF6B7D");
      return;
    }

    // 7. Investigator Powers
    if (st.modal === "investigator_powers" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        <div style="font-size:12px;color:var(--muted);font-weight:800;">رصيدك: <b style="color:var(--cyan);" class="tnum">${vis.self.points} نقطة</b></div>
        <button class="power-tile" onclick="onUseAbility('STEALTH')" ${vis.self.stealthUsesRemaining <= 0 ? "disabled" : ""}>
          <div><div style="font-weight:900;font-size:13px;">إخفاء من الرصد القادم</div><div style="font-size:11px;color:var(--muted);">لا يظهر موقعك في قراءة الرادار التالية</div></div>
          <span class="pill pill-green">مجاني (${vis.self.stealthUsesRemaining})</span>
        </button>
        <button class="power-tile" onclick="onUseAbility('PROTECT')">
          <div><div style="font-weight:900;font-size:13px;color:var(--cyan);">درع الحماية (15ث)</div><div style="font-size:11px;color:var(--muted);">يمنع الغدّار من إقصائك مؤقتاً</div></div>
          <span class="pill pill-cyan tnum">${C.PROTECTION_COST}ن</span>
        </button>
        <div class="card" style="padding:10px;">
          <div style="font-size:11.5px;font-weight:800;color:var(--cyan);margin-bottom:6px;">مسح منطقة محددة (${C.LOCATION_QUESTION_COST}ن):</div>
          <div class="grid-2" style="gap:5px;">
            ${(vis.landmarks || []).map((lm) =>
              `<button class="btn btn-outline btn-xs" style="justify-content:flex-start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="onScanPlace('${esc(lm.id)}')">${esc(lm.name)}</button>`
            ).join("")}
          </div>
        </div>
        <button class="power-tile" style="border-color:var(--amber-border);" onclick="onUseAbility('BOLD_HINT')">
          <div><div style="font-weight:900;font-size:13px;color:var(--amber);">تلميح مباشر عن الغدّار</div><div style="font-size:11px;color:var(--muted);">تحديد أقرب شارع ومسافة تقريبية للغدّار</div></div>
          <span class="pill pill-amber tnum">${C.BOLD_HINT_COST}ن</span>
        </button>
      `;
      mr.innerHTML = bottomSheetHtml("أدوات المحقق", body, "var(--cyan)");
      return;
    }

    // 8. Broker Secret Deal
    if (st.modal === "broker" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isImp = vis.self.role === "IMPOSTER";
      const body = `
        <p style="font-size:12.5px;color:var(--muted);font-weight:700;margin:0;line-height:1.6;">
          الثمن في الحالتين: <span style="color:var(--crimson);">ينكشف موقعك مباشرة بالأحمر للجميع لمدة 15 ثانية.</span>
        </p>
        <button class="btn btn-warning" onclick="onAcceptBroker('intel')">
          ${isImp ? "كشف مكان ومسافة أقرب محقق" : "كشف مكان ومسافة أقرب غدّار"}
        </button>
        <button class="btn btn-success" onclick="onAcceptBroker('cash')">الحصول على +${C.BROKER_CASH_REWARD} نقطة</button>
        <button class="btn btn-outline" onclick="onCloseModal()">رفض الصفقة</button>
      `;
      mr.innerHTML = bottomSheetHtml("صفقة السمسار", body, "var(--amber)");
      return;
    }

    // 9. Direct Accusation
    if (st.modal === "spoken" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        <div class="intel-item" style="border-right-color:var(--amber);">
          لو اتهامك صح الغدّار بيخرج فوراً؛ ولو غلط بتخسر ${C.SPOKEN_PENALTY_POINTS}ن وينكشف مكانك 10 ثواني.
        </div>
        ${vis.players.filter((p) => p.alive && p.id !== vis.self.id).map((p) => `
          <button class="power-tile" onclick="onSpokenName('${p.id}')">
            <div style="display:flex;align-items:center;gap:10px;">
              ${avatarBadge(p.name)}
              <span style="font-weight:800;font-size:13.5px;">${esc(p.name)}</span>
            </div>
            <span class="pill pill-red">اتهام</span>
          </button>
        `).join("")}
      `;
      mr.innerHTML = bottomSheetHtml("اتهام مباشر", body, "var(--cyan)");
      return;
    }

    // 10. AI Profiler & Events Log
    if (st.modal === "intel_log" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        ${vis.aiReports.length
          ? [...vis.aiReports].reverse().map((r) => `
              <div class="intel-item">
                <div class="eyebrow" style="color:var(--crimson);margin-bottom:2px;">${r.source === "groq" ? "GROQ AI" : "RADAR INTEL"}</div>
                ${esc(r.summaryText)}
              </div>
            `).join("")
          : `<div style="font-size:12px;color:var(--muted);text-align:center;padding:10px;">المحلل يراقب التحركات — أول تقرير بعد 85 ثانية.</div>`
        }
        <div class="eyebrow" style="margin-top:4px;">سجل الأحداث</div>
        ${[...vis.events].reverse().slice(0, 12).map((e) => `
          <div class="chat-msg">${esc(e.message)}</div>
        `).join("")}
      `;
      mr.innerHTML = bottomSheetHtml("سجل المحلل والميدان", body);
      return;
    }

    // 11. Simulation Tools
    if (st.modal === "sim_tools" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isSpread = vis.phase === "SPREAD";
      const body = `
        <div class="grid-2">
          <button class="btn btn-crimson-outline btn-sm" onclick="onSimToggleRole();onCloseModal()">تبديل الدور (غدّار/محقق)</button>
          <button class="btn btn-cyan btn-sm" onclick="onToggleSimDpad();onCloseModal()">${st.simDpadVisible ? "إخفاء أسهم التحريك" : "أسهم التحريك"}</button>
          <button class="btn btn-outline btn-sm" onclick="cycleSimSpeed();Kameen.UI.renderModal()">السرعة: ${st.simSpeed}x</button>
          ${isSpread
            ? `<button class="btn btn-warning btn-sm" onclick="onSimSkipSpread();onCloseModal()">تخطي التشتيت</button>`
            : `<button class="btn btn-outline btn-sm" onclick="onSimForceAI();onCloseModal()">تقرير AI الآن</button>`}
          <button class="btn btn-outline btn-sm" ${isSpread ? "disabled" : ""} onclick="onSimRadar();onCloseModal()">تحديث الرصد الآن</button>
          <button class="btn btn-outline btn-sm" ${isSpread ? "disabled" : ""} onclick="onSimSpawnAirdrop();onCloseModal()">إنزال إمداد</button>
          <button class="btn btn-outline btn-sm" ${isSpread ? "disabled" : ""} onclick="onSimTriggerBroker();onCloseModal()">صفقة سمسار</button>
          <button class="btn btn-outline btn-sm" onclick="onSimShrinkZone();onCloseModal()">تصغير الزون</button>
        </div>
        <button class="btn btn-danger btn-sm" style="width:100%;" onclick="exitGameToLanding()">إنهاء المحاكاة</button>
      `;
      mr.innerHTML = bottomSheetHtml("أدوات المحاكاة", body, "var(--amber)");
      return;
    }

    // 12. Mission Camera Proof (Strict Groq Vision + Whisper AI Referee)
    if (st.modal === "camera" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const m = (vis.missions || []).find((x) => x.id === st.activeCameraMissionId);
      const hasKey = Boolean(((st.groqKey || K.CONFIG.DEFAULT_GROQ_KEY || "")).trim());
      const needVideo = Boolean(m && (m.mediaType === "video" || (m.requiresSpeech && m.requiresSpeech.length)));
      const acceptAttr = (m && m.requiresSpeech && m.requiresSpeech.length) ? "video/*" : "image/*,video/*";
      const btnLabel = (m && m.requiresSpeech && m.requiresSpeech.length)
        ? "صوّر فيديو قصير بالصوت (3-8 ثواني)"
        : (needVideo ? "صوّر فيديو قصير (3-8 ثواني)" : "صوّر صورة أو فيديو للمهمة");

      const body = `
        ${m ? `
          <div class="card" style="border-right:3px solid var(--amber);padding:12px;">
            <div style="font-weight:900;font-size:14px;color:var(--text);">${esc(m.title)}</div>
            <div style="font-size:12px;color:var(--muted);font-weight:600;margin-top:4px;line-height:1.55;">${esc(m.description)}</div>
            <div style="font-size:11px;color:var(--cyan);font-weight:800;margin-top:7px;">فحص AI: ${esc(m.aiHintAr || "الذكاء الاصطناعي هيفحص اللقطة بدقة.")}</div>
          </div>
        ` : ""}
        ${!hasKey ? `
          <div class="intel-item" style="border-right-color:var(--crimson);">
            مفتاح Groq AI غير مضاف! عشان الذكاء الاصطناعي يحلل المهمة، اضغط الزرار اللي تحت والصق مفتاحك.
            <button class="btn btn-crimson-outline btn-xs" style="width:100%;margin-top:8px;" onclick="onOpenModal('game_settings')">إضافة مفتاح Groq AI الآن</button>
          </div>
        ` : ""}
        <div id="cam-verdict-box" class="${st.videoVerdict ? "" : "hidden"}"
          style="background:var(--amber-tint);border:1px solid var(--amber-border);color:#FCD34D;padding:11px;border-radius:10px;font-size:12px;font-weight:800;text-align:center;line-height:1.6;">
          ${esc(st.videoVerdict || "")}
        </div>
        <label class="btn btn-primary" style="width:100%;cursor:pointer;padding:14px;${!hasKey ? "opacity:0.45;" : ""}">
          <span id="cam-upload-lbl" data-default-label="${esc(btnLabel)}">${st.videoAnalyzing ? "الذكاء الاصطناعي بيفحص اللقطة..." : btnLabel}</span>
          <input type="file" accept="${acceptAttr}" capture="environment" style="display:none;"
            onchange="if(this.files&&this.files[0])void Kameen.AI.analyzeMissionMedia(Kameen.state.activeCameraMissionId, this.files[0]);this.value='';" />
        </label>
      `;
      mr.innerHTML = bottomSheetHtml("توثيق المهمة بالذكاء الاصطناعي", body, "var(--amber)");
      updateCameraModalStatus();
      return;
    }

    mr.innerHTML = "";
  }

  K.UI = {
    updateGpsStatusDOM,
    updateHudOnly,
    renderPage,
    renderModal,
    updateMissionsDynamic,
    updateMeetingDynamic,
    updateResultChatDOM,
    updateCameraModalStatus,
    updatePrecisionSheetDynamic,
  };
})(window.Kameen);
