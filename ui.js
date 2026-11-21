"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const esc = K.escHtml;
  const fmt = K.fmtClock;

  const ICONS = {
    play: `<svg viewBox="0 0 24 24"><polygon points="6 4 20 12 6 20 6 4"/></svg>`,
    sim: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
    book: `<svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    user: `<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    gear: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    back: `<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`,
  };

  function avatarBadge(name) {
    const clean = String(name || "X").trim();
    const letter = clean.charAt(0) || "X";
    const bg = K.getAvatarColor(clean);
    return `<div class="avatar-dot" style="background:${bg};">${esc(letter)}</div>`;
  }

  function formatGpsStatusText() {
    const st = K.state;
    if (!st.gps.accuracy) return st.gps.error || "بيلقط GPS... 🟡";
    const a = st.gps.accuracy;
    if (a <= 12) return `GPS ممتاز (±${a}م) 🟢`;
    if (a <= 28) return `GPS متوسط (±${a}م) 🟡`;
    return `GPS ضعيف (±${a}م) 🔴`;
  }

  function updateGpsStatusDOM() {
    const st = K.state;
    const gpsTxt = formatGpsStatusText();
    const lEl = document.getElementById("landing-gps-text");
    if (lEl) lEl.textContent = gpsTxt;
    const pSub = document.getElementById("perm-gps-sub");
    if (pSub) pSub.textContent = gpsTxt;
    const pBtn = document.getElementById("perm-gps-btn");
    if (pBtn) pBtn.textContent = st.gps.status === "granted" ? "معايرة 📡" : "تفعيل GPS";
  }

  function renderAppHeader() {
    const st = K.state;
    const hdr = document.getElementById("app-header");
    if (!hdr) return;

    if (st.route === "landing" || st.route === "howto" || st.route === "profile") {
      hdr.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;min-width:0;">
          <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-sm" alt="كمين" />
          <div style="min-width:0;">
            <div style="font-size:15px;font-weight:900;line-height:1.15;">كمين — KAMEEN</div>
            <div id="landing-gps-text" style="font-size:10.5px;font-weight:700;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(formatGpsStatusText())}</div>
          </div>
        </div>
        <button class="icon-btn" aria-label="الإعدادات" onclick="onOpenModal('permissions')">${ICONS.gear}</button>
      `;
    } else if (st.route === "lobby" && st.lobby) {
      hdr.innerHTML = `
        <button class="icon-btn" onclick="onLeaveLobby()">${ICONS.back}</button>
        <div style="font-weight:900;font-size:15px;">${esc(st.lobby.title)}</div>
        <span class="pill sb-status-badge" style="background:var(--green-soft);color:#6EE7B7;">متصل 🟢</span>
      `;
    } else if (st.route === "meeting" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const m = vis.activeMeeting;
      const rem = m ? Math.max(0, Math.ceil((m.endsAtMs - vis.nowMs) / 1000)) : 0;
      hdr.innerHTML = `
        <span class="pill" style="background:var(--crimson-soft);color:#FF6B86;">🚨 اجتماع طارئ</span>
        <div style="font-weight:900;font-size:13px;">مين الغدّار؟</div>
        <span id="meeting-timer-badge" class="pill" style="background:var(--crimson);color:#fff;font-size:13px;">${rem}ث</span>
      `;
    } else if (st.route === "result") {
      hdr.innerHTML = `
        <button class="icon-btn" onclick="exitGameToLanding()">${ICONS.back}</button>
        <div style="font-weight:900;font-size:15px;">نتيجة الكمين</div>
        <div style="width:38px;"></div>
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
      <button class="tab-item" onclick="onStartSimulation()">
        ${ICONS.sim}<span>محاكاة</span>
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
      <button class="dpad-btn" style="font-size:11px;" onclick="Kameen.Map.recenter()">📍</button>
      <button class="dpad-btn" onclick="onSimNudge(0, -12)">◀</button>
      <div></div>
      <button class="dpad-btn" onclick="onSimNudge(-12, 0)">▼</button>
      <div></div>
    `;
  }

  // =========================================================================
  // ROLE-SEPARATED MAP HUD (Create / Imposter / Investigator / Ghost)
  // =========================================================================
  function updateHudOnly() {
    const st = K.state;
    const topEl = document.getElementById("map-hud-top");
    const sideEl = document.getElementById("map-side-fabs");
    const botEl = document.getElementById("map-hud-bottom");
    if (!topEl || !sideEl || !botEl) return;

    const styleIcons = { dark: "🌑", satellite: "🛰️", street: "🗺️", radar: "📡" };
    const styleIco = styleIcons[st.mapStyle] || "🗺️";

    renderSimDpad();

    // --- A) CREATE ZONE SCREEN ---
    if (st.route === "create") {
      K.setBodyRoleTheme("neutral");
      K.setDangerVignette(false);
      if (K.isUserTyping() && document.activeElement.id === "create-title-inp") return;
      const f = st.createForm;
      topEl.innerHTML = `
        <div class="dynamic-capsule">
          <button class="icon-btn" style="width:34px;height:34px;" onclick="onNav('landing')">${ICONS.back}</button>
          <div style="text-align:center;">
            <div style="font-size:13px;font-weight:900;">تحديد منطقة الكمين</div>
            <div style="font-size:10px;color:${st.gps.hasRealFix ? "var(--green)" : "var(--gold)"};font-weight:700;">${st.gps.hasRealFix ? `GPS متصل (±${st.gps.accuracy}م) • اضغط لتحريك الزون` : "📡 جاري لقط موقعك الحقيقي..."}</div>
          </div>
          <div style="width:34px;"></div>
        </div>
      `;
      sideEl.innerHTML = `
        <button class="map-fab" title="تغيير الخريطة" onclick="Kameen.Map.cycleStyle()">${styleIco}</button>
        <button class="map-fab" title="موقعي" onclick="onUseMyLocationForZone()">📍</button>
      `;
      botEl.innerHTML = `
        <div class="hud-glass" style="display:flex;flex-direction:column;gap:9px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span id="create-radius-lbl" style="font-size:12px;font-weight:900;">نصف القطر: <span style="color:var(--gold);">${f.radius}م</span> • ${f.pois.length} معلم (${esc(f.poiSource || "جاهز")})</span>
            <button class="btn btn-outline btn-xs" onclick="onToggleCreatePanel()">${f.panelCollapsed ? "إعدادات ⬆️" : "طي ⬇️"}</button>
          </div>
          <input type="range" min="100" max="800" step="25" value="${f.radius}" style="width:100%;accent-color:var(--crimson);"
            oninput="onRadiusSlide(this.value)"
            onchange="void Kameen.Map.fetchOverpassPOIs(Kameen.state.createForm.center, Kameen.state.createForm.radius)" />
          ${!f.panelCollapsed ? `
            <input id="create-title-inp" class="input" style="padding:9px 12px;font-size:12px;" value="${esc(f.title)}"
              oninput="Kameen.state.createForm.title=this.value" placeholder="اسم الجيم (مثال: كمين شارع 9)" />
            <div class="grid-3">
              <div>
                <div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:3px;">مدة الجيم</div>
                <div class="grid-3" style="gap:3px;">
                  ${[10, 15, 20].map((d) => `<button class="seg-btn ${f.duration===d?'active':''}" onclick="onSetCreateField('duration',${d})">${d}د</button>`).join("")}
                </div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:3px;">التشتيت</div>
                <div class="grid-3" style="gap:3px;">
                  ${[30, 60, 120].map((s) => `<button class="seg-btn ${f.spreadSeconds===s?'active':''}" onclick="onSetCreateField('spreadSeconds',${s})">${s<60?s+'ث':(s/60)+'د'}</button>`).join("")}
                </div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:3px;">الغدّارين</div>
                <div class="grid-2" style="gap:3px;">
                  ${[1, 2].map((n) => `<button class="seg-btn ${f.imposters===n?'active':''}" onclick="onSetCreateField('imposters',${n})">${n}</button>`).join("")}
                </div>
              </div>
            </div>
          ` : ""}
          <button class="btn btn-primary" style="width:100%;padding:13px;" onclick="onCreateMatch()">افتح اللوبي واعزم الشلة 🔥</button>
        </div>
      `;
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const C = K.GAME_CONSTANTS;
    const isImp = vis.self.role === "IMPOSTER";
    const isSpread = vis.phase === "SPREAD";
    const isAlive = vis.self.alive;

    // Apply Dynamic Role Theme to whole app!
    K.setBodyRoleTheme(!isAlive ? "ghost" : (isImp ? "imposter" : "investigator"));
    K.setDangerVignette(Boolean(vis.outsideZoneRemainingMs !== null || vis.showdownActive));

    const activeMission = vis.missions.find((m) => m.status === "in_progress");
    const activeDist = activeMission
      ? Math.round(K.Geo.distanceMeters(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng }))
      : null;

    const nearbyBody = vis.bodies.find((b) => !b.reported && K.Geo.distanceMeters(vis.self.coords, b.coords) <= C.REPORT_BODY_DISTANCE_M + 4);
    const killCdSec = Math.max(0, Math.ceil((vis.self.killCooldownUntilMs - vis.nowMs) / 1000));

    const brokerActive = vis.activeBrokerOffer &&
      vis.nowMs < vis.activeBrokerOffer.expiresAtMs &&
      isAlive &&
      !vis.activeBrokerOffer.acceptedByPlayerIds.includes(vis.self.id);
    const brokerRem = brokerActive ? Math.ceil((vis.activeBrokerOffer.expiresAtMs - vis.nowMs) / 1000) : 0;

    const drop = vis.activeAirdrop;
    const dropDist = drop ? Math.round(K.Geo.distanceMeters(vis.self.coords, drop.coords)) : null;
    const dropCanClaim = drop && isAlive && dropDist <= C.AIRDROP_CLAIM_RANGE_M + 5;

    const invPct = Math.min(100, Math.round((vis.investigationDone / Math.max(1, vis.investigationGoal)) * 100));

    // Side Floating Circular Map FABs (Clean Native Map Look!)
    sideEl.innerHTML = `
      <button class="map-fab" title="نمط الخريطة" onclick="Kameen.Map.cycleStyle()">${styleIco}</button>
      <button id="follow-gps-fab" class="map-fab ${st.mapFollowMe ? "active-fab" : ""}" title="تتبع موقعي" onclick="Kameen.Map.recenter()">📍</button>
      <button class="map-fab" title="الصوت" onclick="Kameen.SFX.toggle();Kameen.UI.updateHudOnly()">${K.SFX.muted ? "🔇" : "🔊"}</button>
      ${st.route === "simulation" ? `<button class="map-fab active-fab" title="أدوات المحاكاة" onclick="onOpenModal('sim_tools')">🧪</button>` : ""}
    `;

    // --- B) GHOST / SPECTATOR DEDICATED SCREEN ---
    if (!isAlive) {
      topEl.innerHTML = `
        <div class="dynamic-capsule">
          <span class="pill" style="background:rgba(148,163,184,0.2);color:#CBD5E1;">👻 وضع الشبح</span>
          <div style="text-align:center;">
            <div style="font-weight:900;font-size:13px;">${fmt(vis.remainingMatchMs)}</div>
            <div style="font-size:9.5px;color:var(--muted);font-weight:700;">أحياء: ${vis.players.filter((p) => p.alive).length} • بتتفرج على الكل لايف</div>
          </div>
          <span class="pill" style="background:var(--surface-2);color:var(--muted);">زون ${vis.zone.currentRadiusMeters}م</span>
        </div>
        ${st.lastIntel ? `
          <div class="hud-glass" style="padding:8px 12px;font-size:11.5px;font-weight:800;" onclick="onOpenModal('intel_log')">
            ${esc(st.lastIntel)}
          </div>
        ` : ""}
      `;
      botEl.innerHTML = `
        <div class="role-dock" style="grid-template-columns:1fr 1fr;">
          <button class="dock-btn primary-dock" onclick="onOpenModal('intel_log')">
            <span class="dock-ico">🤖</span><span>سجل المحلل (${vis.aiReports.length})</span>
          </button>
          <button class="dock-btn" onclick="exitGameToLanding()">
            <span class="dock-ico">🚪</span><span>خروج للرئيسية</span>
          </button>
        </div>
      `;
      return;
    }

    // --- C) IMPOSTER (الغدّار) DEDICATED HUNTER SCREEN ---
    if (isImp) {
      const nt = vis.nearestTarget;
      const proxLabel = !isSpread && nt
        ? (nt.inKillRange
            ? `🔥 جوه مدى التفنيش! (${nt.dist}م)`
            : nt.inSenseRange
              ? `🎯 صيدة قريبة: ${nt.dist}م`
              : `🔍 أقرب صيدة: ${nt.dist}م`)
        : "🏃 وقت التشتيت";

      topEl.innerHTML = `
        <div class="dynamic-capsule">
          <span class="pill" style="background:var(--crimson-soft);color:#FF6B86;">🔪 الغدّار • ${vis.self.points}ن</span>
          <div style="text-align:center;">
            <div style="font-weight:900;font-size:14px;line-height:1.1;color:${isSpread ? "var(--gold)" : "#fff"};">
              ${isSpread ? "تشتيت " + fmt(vis.spreadRemainingMs) : fmt(vis.remainingMatchMs)}
            </div>
            <div style="font-size:9.5px;color:var(--muted);font-weight:700;">
              صيدات: ${vis.players.filter((p) => p.alive && p.role !== "IMPOSTER").length} • <span id="hud-compass-lbl" style="color:#FF6B86;">🧭 ${K.App.headingToArabic(st.gps.heading)}</span>
            </div>
          </div>
          <span class="pill" style="background:rgba(255,46,84,0.14);color:#FDA4AF;font-size:10px;">
            ${vis.aiJammed ? `⚡ ${vis.aiJammedRemainingSec}ث` : `زون ${vis.zone.currentRadiusMeters}م`}
          </span>
        </div>

        ${isSpread ? `<div class="alert-strip" style="background:rgba(10,14,24,0.92);border:1px solid var(--gold);color:#FDE68A;">🏃 وقت التشتيت — اختار مكانك قبل ما الصيد يبدأ!</div>` : ""}
        ${!isSpread && vis.postSpreadGraceSec > 0 ? `<div class="alert-strip" style="background:rgba(10,14,24,0.92);border:1px solid var(--crimson);color:#FDA4AF;">⏳ التفنيش هيتفتح بعد ${vis.postSpreadGraceSec} ثانية — اتمشى طبيعي!</div>` : ""}
        ${vis.showdownActive ? `<div class="alert-strip" style="background:linear-gradient(90deg,#991B1B,#FF2E54,#991B1B);color:#fff;">🔥 الخاتمة السخنة! تهدئة التفنيش قلت للنص!</div>` : ""}
        ${vis.outsideZoneRemainingMs !== null ? `<div class="alert-strip pulse-red" style="background:var(--crimson);color:#fff;">⚠️ إنت برّه الزون! ادخل خلال ${Math.ceil(vis.outsideZoneRemainingMs / 1000)}ث!</div>` : ""}
        ${vis.isRevealActive ? `<div class="alert-strip" style="background:rgba(255,46,84,0.92);color:#fff;">📡 الرادار شغال (${Math.ceil(vis.revealRemainingMs / 1000)}ث) — الكل مكشوف!</div>` : ""}

        ${brokerActive ? `
          <button class="btn btn-warning btn-sm pulse-gold" style="width:100%;" onclick="onOpenModal('broker')">
            🤝 عرض السمسار للغدّار! اعرف مكان أقرب صيدة أو +60ن (${brokerRem}ث)
          </button>
        ` : ""}

        ${drop ? `
          <div class="hud-glass" style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-color:var(--gold);gap:8px;">
            <span style="font-size:11px;font-weight:800;color:#FDE68A;">💼 إمداد ${esc(drop.place)} (${dropDist}م)</span>
            ${dropCanClaim
              ? `<button class="btn btn-warning btn-xs pulse-gold" onclick="onClaimAirdrop()">القطها (+45ن) 🔥</button>`
              : `<span style="font-size:10px;color:var(--muted);font-weight:800;">${Math.ceil((drop.expiresAtMs - vis.nowMs) / 1000)}ث</span>`}
          </div>
        ` : ""}

        ${activeMission && !isSpread ? `
          <div class="hud-glass" style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-color:rgba(255,46,84,0.45);gap:8px;">
            <div style="min-width:0;">
              <div style="font-size:11.5px;font-weight:900;color:#FDA4AF;">🎭 تمويه: ${esc(activeMission.poi.name)}</div>
              <div style="font-size:10.5px;color:var(--muted);font-weight:700;">باقي ${activeDist}م • +${activeMission.rewardPoints}ن</div>
            </div>
            <button class="btn btn-primary btn-xs" ${activeDist <= C.MISSION_RANGE_M + 5 ? "" : "disabled"} onclick="openCameraForMission('${activeMission.id}')">
              ${activeDist <= C.MISSION_RANGE_M + 5 ? "توثيق 📸" : "قرّب"}
            </button>
          </div>
        ` : ""}

        ${st.lastIntel ? `
          <div class="hud-glass" style="padding:9px 12px;border-color:var(--crimson);font-size:11.5px;font-weight:800;line-height:1.5;" onclick="onOpenModal('intel_log')">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <span>${esc(st.lastIntel)}</span>
              <span style="color:var(--muted);padding:2px 6px;" onclick="event.stopPropagation();Kameen.state.lastIntel=null;Kameen.UI.updateHudOnly()">✖</span>
            </div>
          </div>
        ` : ""}
      `;

      botEl.innerHTML = `
        <div style="display:flex;justify-content:center;align-items:center;gap:8px;flex-wrap:wrap;">
          ${!isSpread && nt ? `
            <button class="hero-action-fab ${nt.inKillRange && killCdSec === 0 ? "pulse-red" : ""}"
              style="background:${nt.inKillRange && killCdSec === 0 ? "linear-gradient(135deg,#FF2E54,#991B1B)" : "rgba(18,24,38,0.92)"};border-color:${nt.inKillRange ? "#FF6B86" : "rgba(255,46,84,0.35)"};"
              ${killCdSec > 0 || !nt.inKillRange ? "disabled" : ""}
              onclick="onKillTarget('${nt.id}')">
              ${killCdSec > 0
                ? `⏳ تهدئة التفنيش (${killCdSec}ث)`
                : nt.inKillRange
                  ? `🔪 فنش ${esc(nt.name || "الهدف")} دلوقتي!`
                  : proxLabel}
            </button>
          ` : ""}
          ${!isSpread && nearbyBody ? `
            <button class="btn btn-outline btn-sm" style="border-color:var(--gold);color:#FDE68A;" onclick="onReportBody('${nearbyBody.id}')">
              🚨 بلّغ تمويه (${esc(nearbyBody.victimName)})
            </button>
          ` : ""}
        </div>

        <div class="role-dock">
          <button class="dock-btn" onclick="Kameen.Map.recenter()">
            <span class="dock-ico">🩸</span><span>الصيد</span>
          </button>
          <button class="dock-btn" ${isSpread ? "disabled" : ""} onclick="onOpenModal('missions_sheet')">
            <span class="dock-ico">🎭</span><span>التمويه</span>
            <span class="dock-badge">${vis.missions.filter((m) => m.status === "completed").length}/3</span>
          </button>
          <button class="dock-btn primary-dock" ${isSpread ? "disabled" : ""} onclick="onOpenModal('imposter_powers')">
            <span class="dock-ico">😈</span><span>ألاعيب</span>
            <span class="dock-badge">${vis.self.points}</span>
          </button>
          <button class="dock-btn" onclick="onOpenModal('intel_log')">
            <span class="dock-ico">🤖</span><span>المحلل</span>
            ${vis.aiReports.length ? `<span class="dock-badge">${vis.aiReports.length}</span>` : ""}
          </button>
        </div>
      `;
      return;
    }

    // --- D) INVESTIGATOR (المحقق) DEDICATED DETECTIVE SCREEN ---
    topEl.innerHTML = `
      <div class="dynamic-capsule" style="flex-direction:column;align-items:stretch;gap:4px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
          <span class="pill" style="background:var(--cyan-soft);color:#67E8F9;">🕵️ المحقق • ${vis.self.points}ن</span>
          <div style="text-align:center;">
            <div style="font-weight:900;font-size:14px;line-height:1.1;color:${isSpread ? "var(--gold)" : "#fff"};">
              ${isSpread ? "تشتيت " + fmt(vis.spreadRemainingMs) : fmt(vis.remainingMatchMs)}
            </div>
            <div style="font-size:9.5px;color:var(--muted);font-weight:700;">
              أحياء: ${vis.players.filter((p) => p.alive).length} • <span id="hud-compass-lbl" style="color:#67E8F9;">🧭 ${K.App.headingToArabic(st.gps.heading)}</span>
            </div>
          </div>
          <span class="pill" style="background:rgba(0,212,255,0.12);color:#7DD3FC;font-size:10px;">
            ${vis.self.protectedUntilMs > vis.nowMs ? `🛡️ ${Math.ceil((vis.self.protectedUntilMs - vis.nowMs) / 1000)}ث` : `زون ${vis.zone.currentRadiusMeters}م`}
          </span>
        </div>
        ${!isSpread ? `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:9.5px;font-weight:800;color:#67E8F9;white-space:nowrap;">🔍 القضية ${invPct}%</span>
            <div class="inv-progress-track" style="margin-top:0;">
              <div class="inv-progress-fill" style="width:${invPct}%;"></div>
            </div>
          </div>
        ` : ""}
      </div>

      ${isSpread ? `<div class="alert-strip" style="background:rgba(10,14,24,0.92);border:1px solid var(--gold);color:#FDE68A;">🏃 وقت التشتيت — اتفرقوا في الحي قبل ما الغدّار يبدأ!</div>` : ""}
      ${!isSpread && vis.postSpreadGraceSec > 0 ? `<div class="alert-strip" style="background:rgba(10,14,24,0.92);border:1px solid var(--green);color:#6EE7B7;">🛡️ فترة أمان (${vis.postSpreadGraceSec}ث) — ابدأ أول مهمة ليك!</div>` : ""}
      ${vis.showdownActive ? `<div class="alert-strip" style="background:linear-gradient(90deg,#991B1B,#FF2E54,#991B1B);color:#fff;">🔥 الخاتمة السخنة! الرادار كل 45ث — اصمد أو خلّص القضية!</div>` : ""}
      ${vis.aiJammed ? `<div class="alert-strip" style="background:rgba(10,14,24,0.94);border:1px solid var(--cyan);color:#7DD3FC;">⚡ الغدّار عامل تشويش! المحلل والرادار فصلوا مؤقتاً!</div>` : ""}
      ${vis.outsideZoneRemainingMs !== null ? `<div class="alert-strip pulse-red" style="background:var(--crimson);color:#fff;">⚠️ إنت برّه الزون! ادخل خلال ${Math.ceil(vis.outsideZoneRemainingMs / 1000)}ث!</div>` : ""}
      ${vis.isRevealActive ? `<div class="alert-strip" style="background:linear-gradient(90deg,#0369A1,#00B4D8);color:#fff;">📡 الرادار كاشف أماكن الكل لمدة ${Math.ceil(vis.revealRemainingMs / 1000)}ث!</div>` : ""}

      ${brokerActive ? `
        <button class="btn btn-warning btn-sm pulse-gold" style="width:100%;" onclick="onOpenModal('broker')">
          🤝 عرض السمسار! اعرف مكان أقرب غدّار أو +60ن (${brokerRem}ث)
        </button>
      ` : ""}

      ${drop ? `
        <div class="hud-glass" style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-color:var(--gold);gap:8px;">
          <span style="font-size:11px;font-weight:800;color:#FDE68A;">💼 إمداد ${esc(drop.place)} (${dropDist}م)</span>
          ${dropCanClaim
            ? `<button class="btn btn-warning btn-xs pulse-gold" onclick="onClaimAirdrop()">القطها (+45ن + درع) 🔥</button>`
            : `<span style="font-size:10px;color:var(--muted);font-weight:800;">${Math.ceil((drop.expiresAtMs - vis.nowMs) / 1000)}ث</span>`}
        </div>
      ` : ""}

      ${activeMission && !isSpread ? `
        <div class="hud-glass" style="padding:8px 12px;display:flex;justify-content:space-between;align-items:center;border-color:var(--cyan);gap:8px;">
          <div style="min-width:0;">
            <div style="font-size:11.5px;font-weight:900;color:#67E8F9;">🎯 ${esc(activeMission.poi.name)}</div>
            <div style="font-size:10.5px;color:var(--muted);font-weight:700;">باقي ${activeDist}م • ${K.Geo.getArabicDirection(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng })}</div>
          </div>
          <button class="btn btn-cyan btn-xs" ${activeDist <= C.MISSION_RANGE_M + 5 ? "" : "disabled"} onclick="openCameraForMission('${activeMission.id}')">
            ${activeDist <= C.MISSION_RANGE_M + 5 ? "صوّر الدليل 📸" : "قرّب"}
          </button>
        </div>
      ` : ""}

      ${st.lastIntel ? `
        <div class="hud-glass" style="padding:9px 12px;border-color:var(--cyan);font-size:11.5px;font-weight:800;line-height:1.5;" onclick="onOpenModal('intel_log')">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span>${esc(st.lastIntel)}</span>
            <span style="color:var(--muted);padding:2px 6px;" onclick="event.stopPropagation();Kameen.state.lastIntel=null;Kameen.UI.updateHudOnly()">✖</span>
          </div>
        </div>
      ` : ""}
    `;

    botEl.innerHTML = `
      ${!isSpread && nearbyBody ? `
        <button class="hero-action-fab pulse-red" style="background:linear-gradient(135deg,#FF2E54,#991B1B);" onclick="onReportBody('${nearbyBody.id}')">
          🚨 لقيت جثة ${esc(nearbyBody.victimName)} — اطلب اجتماع!
        </button>
      ` : ""}

      <div class="role-dock">
        <button class="dock-btn primary-dock" ${isSpread ? "disabled" : ""} onclick="onOpenModal('missions_sheet')">
          <span class="dock-ico">🎯</span><span>المهام</span>
          <span class="dock-badge">${vis.missions.filter((m) => m.status === "completed").length}/3</span>
        </button>
        <button class="dock-btn" ${isSpread ? "disabled" : ""} onclick="onOpenModal('investigator_powers')">
          <span class="dock-ico">🛡️</span><span>أدواتي</span>
          <span class="dock-badge">${vis.self.points}</span>
        </button>
        <button class="dock-btn" ${isSpread ? "disabled" : ""} onclick="onOpenModal('spoken')">
          <span class="dock-ico">🗣️</span><span>قفشة</span>
        </button>
        <button class="dock-btn" onclick="onOpenModal('intel_log')">
          <span class="dock-ico">🤖</span><span>المحلل</span>
          ${vis.aiReports.length ? `<span class="dock-badge">${vis.aiReports.length}</span>` : ""}
        </button>
      </div>
    `;
  }

  // =========================================================================
  // NON-MAP NATIVE APP PAGES (Home / Lobby / Meeting / Result / Profile / Howto)
  // =========================================================================
  function renderPage() {
    const st = K.state;
    const root = document.getElementById("page-root");
    if (!root) return;
    K.setBodyRoleTheme("neutral");
    K.setDangerVignette(false);
    renderAppHeader();
    renderAppTabBar();

    if (st.route === "landing") {
      const hasAiKey = Boolean((st.groqKey || "").trim());
      root.innerHTML = `
        <div class="hero-radar">
          <div class="hero-content">
            <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="شعار كمين" />
            <div style="font-size:28px;font-weight:900;margin-top:6px;">كمين</div>
            <div style="font-size:12.5px;color:#FDA4AF;font-weight:800;">متأمنش لحد.. حتى صاحبك اللي ماشي جنبك! 👀</div>
            <div style="margin-top:10px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">
              <span class="pill sb-status-badge" style="background:rgba(16,185,129,0.2);color:#6EE7B7;">سوبابيس جاهز 🟢</span>
              <span class="pill" style="background:${hasAiKey ? "rgba(0,212,255,0.18)" : "rgba(255,176,32,0.18)"};color:${hasAiKey ? "#67E8F9" : "#FDE68A"};cursor:pointer;" onclick="onOpenModal('permissions')">
                ${hasAiKey ? "Groq AI لايف 🤖" : "فعّل مفتاح AI ⚙️"}
              </span>
            </div>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;gap:11px;">
          <div>
            <div class="section-label" style="margin-bottom:5px;">اسم العميل بتاعك</div>
            <input id="player-name-input" class="input" type="text" value="${esc(st.user.name)}"
              oninput="Kameen.state.user.name=this.value;try{localStorage.setItem('kameen_name',this.value)}catch{}"
              placeholder="اكتب اسمك الروش..." />
          </div>

          <button class="btn btn-primary" style="width:100%;padding:14px;font-size:14.5px;" onclick="onStartCreateFlow()">
            🗺️ اعمل كمين جديد في الحي
          </button>

          <div style="display:flex;gap:8px;">
            <input id="join-code-input" class="input" type="text" value="${esc(st.joinCode)}"
              oninput="Kameen.state.joinCode=this.value.toUpperCase()"
              onkeydown="if(event.key==='Enter')onJoinByInput()"
              placeholder="كود الروم (KMN402)"
              style="flex:1;text-align:center;letter-spacing:1.5px;text-transform:uppercase;" />
            <button class="btn btn-cyan" style="padding:0 20px;" onclick="onJoinByInput()">ادخل 🚀</button>
          </div>
        </div>

        <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px;border-color:rgba(255,176,32,0.28);cursor:pointer;" onclick="onStartSimulation()">
          <div>
            <div style="font-weight:900;font-size:14px;color:#FDE68A;">🧪 مختبر التجربة الفردي</div>
            <div style="font-size:11px;color:var(--muted);font-weight:700;">جرب صفحة الغدّار والمحقق مع 6 بوتات أذكياء</div>
          </div>
          <span class="pill" style="background:var(--gold-soft);color:#FDE68A;">جرّب</span>
        </div>
      `;
      K.Network.updateConnectionBadges();
      return;
    }

    if (st.route === "lobby" && st.lobby) {
      const l = st.lobby;
      const isHost = l.hostId === st.user.id;
      root.innerHTML = `
        <div class="card" style="text-align:center;border-color:rgba(255,46,84,0.32);">
          <div style="font-size:11px;color:var(--muted);font-weight:800;">كود دخول الروم</div>
          <div style="font-size:38px;font-weight:900;letter-spacing:5px;color:#FDA4AF;margin:4px 0;">${esc(l.code)}</div>
          <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-soft btn-sm" onclick="onCopyInviteCode()">📋 نسخ الكود</button>
            <button class="btn btn-success btn-sm" onclick="onShareWhatsApp()">💬 دعوة واتساب</button>
          </div>
          <div style="margin-top:10px;display:flex;justify-content:center;gap:6px;flex-wrap:wrap;">
            <span class="pill" style="background:var(--surface-2);color:var(--muted);">زون ${l.radius}م</span>
            <span class="pill" style="background:var(--surface-2);color:var(--muted);">${l.duration} دقيقة</span>
            <span class="pill" style="background:var(--surface-2);color:var(--muted);">${l.imposters} غدّار</span>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-weight:900;font-size:14px;">الشلة اللي دخلت (${l.players.length})</span>
            ${isHost ? `<button class="btn btn-soft btn-sm" onclick="onAddBotToLobby()">+ ضيف بوت 🤖</button>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${l.players.map((p) => `
              <div class="player-row">
                <div style="display:flex;align-items:center;gap:10px;">
                  ${avatarBadge(p.name)}
                  <div>
                    <div style="font-size:13px;font-weight:800;">${esc(p.name)}</div>
                    <div style="font-size:10px;color:var(--muted);font-weight:700;">${p.isHost ? "الريس 👑" : (p.isBot ? "بوت ذكي 🤖" : "عميل جاهز")}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:7px;">
                  <span class="status-dot live"></span>
                  ${isHost && !p.isHost ? `<button class="btn btn-outline btn-xs" onclick="onKickLobbyPlayer('${p.id}')">✖</button>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        ${isHost
          ? `<button class="btn btn-primary" style="width:100%;padding:15px;font-size:15px;" onclick="onStartMatchFromLobby()">ابدأ الكمين دلوقتي! 🔥</button>`
          : `<div class="card" style="text-align:center;font-size:13px;font-weight:800;color:var(--gold);">⏳ مستنيين الريس يبدأ الجيم... استعد!</div>`}
      `;
      K.Network.updateConnectionBadges();
      return;
    }

    if (st.route === "meeting" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const m = vis.activeMeeting;
      if (!m) return;
      root.innerHTML = `
        <div class="card" style="background:linear-gradient(135deg,#D91E36,#6E1517);border-color:#FF6B86;padding:12px 15px;">
          <div style="font-size:14px;font-weight:900;">${esc(m.triggeredByName)} لقى جثة ${esc(m.victimName || "ضحية")}!</div>
          <div style="font-size:11px;color:#FFE4E6;font-weight:700;">قارنوا تقارير المحلل وصوّتوا تطردوا مين</div>
        </div>

        <div class="card" style="padding:12px;">
          <div style="font-weight:900;font-size:12px;color:#FDA4AF;margin-bottom:6px;">🤖 آخر تقارير المحلل النفسي:</div>
          <div id="meeting-intel-feed" style="display:flex;flex-direction:column;gap:6px;max-height:92px;overflow-y:auto;">
            ${buildMeetingIntelHtml(vis)}
          </div>
        </div>

        <div class="card" style="padding:12px;">
          <div style="font-weight:900;font-size:12px;margin-bottom:6px;">💬 الخناقة المباشرة:</div>
          <div id="meeting-chat-feed" class="chat-box">${buildMeetingChatHtml(m)}</div>
          ${vis.self.alive ? `
            <div style="display:flex;gap:5px;overflow-x:auto;padding:6px 0 8px;">
              ${K.QUICK_CHAT_LINES.map((q) =>
                `<button class="btn btn-outline btn-xs" style="white-space:nowrap;" onclick="onQuickMeetingChat('${esc(q)}')">${esc(q)}</button>`
              ).join("")}
            </div>
            <div style="display:flex;gap:6px;">
              <input id="meeting-chat-input" class="input" style="padding:9px 12px;font-size:12px;" type="text"
                placeholder="دافع عن نفسك أو اتهم حد..."
                onkeydown="if(event.key==='Enter')onSendMeetingChat()" />
              <button class="btn btn-primary btn-sm" style="padding:0 14px;" onclick="onSendMeetingChat()">ابعت</button>
            </div>
          ` : `<div style="font-size:11px;color:var(--muted);text-align:center;padding-top:6px;">👻 الأشباح بيتفرجوا بس!</div>`}
        </div>

        <div class="card" style="padding:12px;">
          <div style="font-weight:900;font-size:13px;margin-bottom:8px;">🗳️ صوّت مين الغدّار:</div>
          <div id="meeting-votes-section">${buildMeetingVotesHtml(vis)}</div>
        </div>
      `;
      return;
    }

    if (st.route === "result" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const invWin = vis.winner === "INVESTIGATORS";
      root.innerHTML = `
        <div class="card" style="background:${invWin ? "linear-gradient(135deg,#047857,#064E3B)" : "linear-gradient(135deg,#D91E36,#6E1517)"};text-align:center;padding:22px 16px;">
          <div style="font-size:40px;">${invWin ? "🏆🕵️" : "😈🔪"}</div>
          <div style="font-size:23px;font-weight:900;margin-top:4px;">${invWin ? "مبروك للمحققين!" : "الغدّارين كسبوا الجيم!"}</div>
          <div style="font-size:13px;font-weight:700;margin-top:6px;color:#F8FAFC;">${esc(vis.winReason || "")}</div>
        </div>

        <div id="ai-recap-box" class="card intel-item ${vis.aiMatchRecap ? "" : "hidden"}" style="font-size:13px;">
          ${vis.aiMatchRecap ? "🤖 تعليق المحلل: " + esc(vis.aiMatchRecap) : ""}
        </div>

        ${vis.awards && vis.awards.length ? `
          <div class="card">
            <div style="font-weight:900;font-size:14px;margin-bottom:8px;">🏅 ألقاب الشلة</div>
            <div class="grid-2">
              ${vis.awards.map((a) => `
                <div class="award-card">
                  <div style="font-size:24px;">${a.icon}</div>
                  <div style="font-size:12px;font-weight:900;color:#FDE68A;">${esc(a.title)}</div>
                  <div style="font-size:13px;font-weight:800;">${esc(a.player)}</div>
                  <div style="font-size:10px;color:var(--muted);font-weight:700;">${esc(a.stat)}</div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="card">
          <div style="font-weight:900;font-size:14px;margin-bottom:8px;">🎭 كشف المستور</div>
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${vis.players.map((p) => `
              <div class="player-row ${p.alive ? "" : "dead"}">
                <div style="display:flex;align-items:center;gap:9px;">
                  ${avatarBadge(p.name)}
                  <span style="font-size:13px;font-weight:800;">${esc(p.name)}</span>
                </div>
                <span class="pill" style="background:${p.role === "IMPOSTER" ? "var(--crimson-soft)" : "var(--cyan-soft)"};color:${p.role === "IMPOSTER" ? "#FF6B86" : "#67E8F9"};">
                  ${p.role === "IMPOSTER" ? "غدّار 🔪" : "محقق 🕵️"} • ${p.alive ? "عايش" : "طار 💀"}
                </span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <div style="font-weight:900;font-size:13px;margin-bottom:8px;">💬 تصفية الحسابات</div>
          <div id="post-chat-list" class="chat-box" style="margin-bottom:8px;">${buildPostChatHtml(vis.postChat)}</div>
          <div style="display:flex;gap:6px;">
            <input id="post-chat-inp" class="input" style="padding:9px 12px;font-size:12px;" type="text"
              placeholder="قول لصحابك إيه اللي حصل..."
              onkeydown="if(event.key==='Enter')onSendPostChat()" />
            <button class="btn btn-primary btn-sm" style="padding:0 14px;" onclick="onSendPostChat()">ابعت</button>
          </div>
        </div>

        <div class="grid-2">
          <button class="btn btn-primary" onclick="exitGameToCreate()">جيم تاني 🔥</button>
          <button class="btn btn-outline" onclick="exitGameToLanding()">الرئيسية 🏠</button>
        </div>
      `;
      return;
    }

    if (st.route === "profile") {
      const u = st.user;
      const rate = u.matchesPlayed ? Math.round((u.matchesWon / u.matchesPlayed) * 100) : 0;
      root.innerHTML = `
        <div class="card" style="text-align:center;">
          <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
          <div style="font-weight:900;font-size:21px;margin-top:8px;">${esc(u.name)}</div>
          <div style="font-size:11px;color:var(--muted);font-weight:700;">عميل ميداني معتمد في كمين</div>
          <div class="grid-3" style="margin-top:16px;">
            <div style="background:var(--surface-2);padding:12px 6px;border-radius:14px;">
              <div style="font-size:20px;font-weight:900;color:#FDA4AF;">${u.matchesPlayed}</div>
              <div style="font-size:11px;color:var(--muted);font-weight:700;">مباريات</div>
            </div>
            <div style="background:var(--surface-2);padding:12px 6px;border-radius:14px;">
              <div style="font-size:20px;font-weight:900;color:var(--green);">${rate}%</div>
              <div style="font-size:11px;color:var(--muted);font-weight:700;">نسبة الفوز</div>
            </div>
            <div style="background:var(--surface-2);padding:12px 6px;border-radius:14px;">
              <div style="font-size:20px;font-weight:900;color:var(--gold);">${u.missionsCompleted}</div>
              <div style="font-size:11px;color:var(--muted);font-weight:700;">مهام</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (st.route === "howto") {
      root.innerHTML = `
        <div class="card" style="border-color:rgba(0,212,255,0.35);">
          <div style="font-weight:900;font-size:15px;color:#67E8F9;margin-bottom:6px;">🕵️ دور المحقق (أزرق سماوي)</div>
          <div style="font-size:12.5px;font-weight:700;line-height:1.85;color:var(--text);">
            • خلّص مهامك في معالم الحي عشان تملى <b>شريط القضية 100%</b> وتكسب الجيم.<br/>
            • معاك أدواتك الخاصة: <b>درع حماية</b>، <b>مسح معالم الخريطة</b>، <b>تلميح تقيل عن الغدّار</b>، وزرار <b>قفشة</b> (بس لو اتهمت بريء بتخسر 25ن ومكانك بيتكشف!).
          </div>
        </div>
        <div class="card" style="border-color:rgba(255,46,84,0.38);">
          <div style="font-weight:900;font-size:15px;color:#FF6B86;margin-bottom:6px;">🔪 دور الغدّار (أحمر ناري)</div>
          <div style="font-size:12.5px;font-weight:700;line-height:1.85;color:var(--text);">
            • هدفك تصفّي كل المحققين قبل ما يكملوا القضية أو يكتشفوك.<br/>
            • معاك ألاعيبك الخاصة: <b>رادار الصيد</b> (يجيبلك أقرب ضحية)، <b>إشارة حمرا وهمية</b>، <b>تسريب إشاعة مضللة</b>، و<b>تكتيم المحلل والرادار</b> 75 ثانية!
          </div>
        </div>
        <div class="card">
          <div style="font-weight:900;font-size:14px;color:#FDE68A;margin-bottom:6px;">🤖 المحلل النفسي والسمسار والزون</div>
          <div style="font-size:12.5px;font-weight:700;line-height:1.85;">
            • الزون بتصغر 25% كل 3 دقايق واللي يفضل برّاها 20ث بيطير.<br/>
            • المحلل النفسي بيراقب الجري والكمبرة ويدي تلميحات بالمعالم الحقيقية ع الخريطة.<br/>
            • شنط الإمداد الذهبية وصفقة السمسار بيقلبوا الموازين طول الجيم!
          </div>
        </div>
      `;
    }
  }

  function buildMissionsCardsHtml(vis) {
    const C = K.GAME_CONSTANTS;
    const isImp = vis.self.role === "IMPOSTER";
    return vis.missions.map((m) => {
      const dist = Math.round(K.Geo.distanceMeters(vis.self.coords, { lat: m.poi.lat, lng: m.poi.lng }));
      const dir = K.Geo.getArabicDirection(vis.self.coords, { lat: m.poi.lat, lng: m.poi.lng });
      const inRange = dist <= C.MISSION_RANGE_M + 5;
      return `
        <div class="card" style="padding:13px;border-color:${m.status === "in_progress" ? "var(--role-accent)" : "var(--border)"};">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <div style="font-weight:900;font-size:14px;">${esc(m.title)}</div>
            <span class="pill" style="background:var(--gold-soft);color:#FDE68A;">+${m.rewardPoints}ن</span>
          </div>
          <p style="font-size:11.5px;color:var(--muted);font-weight:700;margin:5px 0 7px;">${esc(m.description)}</p>
          <div style="font-size:11px;font-weight:800;color:${isImp ? "#FDA4AF" : "#67E8F9"};margin-bottom:9px;">
            📍 ${esc(m.poi.name)} • ${dist}م (${dir})
          </div>
          ${m.status === "completed"
            ? `<div class="pill" style="background:var(--green-soft);color:#6EE7B7;width:100%;justify-content:center;padding:8px;">✅ مكتملة ومُوثّقة!</div>`
            : m.status === "pending"
              ? `<button class="btn ${isImp ? "btn-primary" : "btn-cyan"} btn-sm" style="width:100%;" onclick="onStartMission('${m.id}')">ابدأ وافتح المسار ع الخريطة 🎯</button>`
              : `<div class="grid-2">
                  <button class="btn btn-outline btn-sm" onclick="onCloseModal();Kameen.Map.recenter()">شوف المسار 🗺️</button>
                  <button class="btn btn-success btn-sm" ${inRange ? "" : "disabled"} onclick="openCameraForMission('${m.id}')">
                    ${inRange ? "صوّر الإثبات 📸" : `قرّب (${dist}م)`}
                  </button>
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
    if (!vis.aiReports.length) return `<div style="font-size:11px;color:var(--muted);">المحلل لسه مبعتش تقارير في الجيم ده.</div>`;
    return [...vis.aiReports].reverse().map((r) => `<div class="intel-item">${esc(r.summaryText)}</div>`).join("");
  }

  function buildMeetingChatHtml(m) {
    if (!m.chat.length) return `<div style="font-size:11px;color:var(--muted);">ابدأ الكلام...</div>`;
    return m.chat.map((c) => `
      <div class="chat-msg">
        <b style="color:${c.senderId === "system" ? "#FF6B86" : "#FDE68A"};">${esc(c.senderName)}:</b>
        <span>${esc(c.text)}</span>
      </div>
    `).join("");
  }

  function buildMeetingVotesHtml(vis) {
    const m = vis.activeMeeting;
    const myVote = m.votes[vis.self.id];
    const living = vis.players.filter((p) => p.alive);
    const votedCount = Object.keys(m.votes).length;
    return `
      <div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:8px;">
        اللي صوّتوا: ${votedCount} / ${living.length} ${myVote ? " • ✅ إنت صوّت خلاص" : ""}
      </div>
      <div class="grid-2">
        ${living.map((p) => {
          const hasVoted = Boolean(m.votes[p.id]);
          const selected = myVote === p.id;
          return `
            <button class="btn ${selected ? "btn-danger" : "btn-outline"}" style="justify-content:flex-start;padding:8px 10px;" ${!vis.self.alive ? "disabled" : ""}
              onclick="onCastVote('${p.id}')">
              ${avatarBadge(p.name)}
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(p.name)}</span>
              ${hasVoted ? '<span style="font-size:10px;margin-right:auto;">✅</span>' : ""}
            </button>
          `;
        }).join("")}
      </div>
      <button class="btn ${myVote === "SKIP" ? "btn-warning" : "btn-soft"}" style="width:100%;margin-top:8px;" ${!vis.self.alive ? "disabled" : ""}
        onclick="onCastVote('SKIP')">
        تخطي التصويت (مفيش دليل كفاية) ⏭️
      </button>
    `;
  }

  function updateMeetingDynamic() {
    if (!K.state.engine) return;
    const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
    const m = vis.activeMeeting;
    if (!m) return;
    const rem = Math.max(0, Math.ceil((m.endsAtMs - vis.nowMs) / 1000));
    const tEl = document.getElementById("meeting-timer-badge");
    if (tEl) tEl.textContent = rem + "ث";
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
    if (!list || !list.length) return `<span style="font-size:11px;color:var(--muted);">محدش كتب حاجة لسه.. ابدأ الضحك!</span>`;
    return list.map((c) => `<div class="chat-msg"><b style="color:#FDE68A;">${esc(c.sender)}:</b> ${esc(c.text)}</div>`).join("");
  }

  function updateResultChatDOM() {
    if (!K.state.engine) return;
    const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
    const el = document.getElementById("post-chat-list");
    if (el) {
      el.innerHTML = buildPostChatHtml(vis.postChat);
      el.scrollTop = el.scrollHeight;
    }
    if (vis.aiMatchRecap) {
      const box = document.getElementById("ai-recap-box");
      if (box) {
        box.textContent = "🤖 تعليق المحلل: " + vis.aiMatchRecap;
        box.classList.remove("hidden");
      }
    }
  }

  function updateCameraModalStatus() {
    const st = K.state;
    const vEl = document.getElementById("cam-verdict-box");
    if (vEl) {
      vEl.textContent = st.videoVerdict || "";
      vEl.classList.toggle("hidden", !st.videoVerdict);
    }
    const lbl = document.getElementById("cam-upload-lbl");
    if (lbl) lbl.textContent = st.videoAnalyzing ? "⏳ الذكاء الاصطناعي بيفحص اللقطة..." : "📸 صوّر صورة أو فيديو سريع";
  }

  // Helper to wrap native slide-up bottom sheet
  function bottomSheetHtml(title, bodyHtml, accentColor = "var(--text)") {
    return `
      <div class="sheet-backdrop" onclick="if(event.target===this)onCloseModal()">
        <div class="bottom-sheet">
          <div class="sheet-handle"></div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:900;font-size:16px;color:${accentColor};">${title}</span>
            <button class="icon-btn" style="width:32px;height:32px;font-size:13px;" onclick="onCloseModal()">✖</button>
          </div>
          <div class="sheet-body">${bodyHtml}</div>
        </div>
      </div>
    `;
  }

  // =========================================================================
  // NATIVE BOTTOM SHEETS & FULL-SCREEN ROLE CARDS
  // =========================================================================
  function renderModal() {
    const st = K.state;
    const mr = document.getElementById("modal-root");
    if (!mr) return;
    const C = K.GAME_CONSTANTS;

    // 1. 3D Secret Role Reveal Card (Center Focus)
    if ((st.route === "game" || st.route === "simulation") && !st.roleRevealed && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isImp = vis.self.role === "IMPOSTER";
      mr.innerHTML = `
        <div class="center-modal-backdrop">
          ${!st.roleFlipped ? `
            <div class="card" style="max-width:340px;width:100%;text-align:center;border-color:var(--crimson);">
              <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
              <div style="font-size:21px;font-weight:900;margin-top:8px;">كارت الدور السري 🃏</div>
              <p style="font-size:13px;color:var(--muted);font-weight:700;">اتأكد محدش بيبص في موبايلك واضغط عشان تعرف إنت مين!</p>
              <button class="btn btn-primary" style="width:100%;margin-top:12px;padding:13px;" onclick="onFlipRoleCard()">اكشف دوري 👀</button>
            </div>
          ` : `
            <div class="role-card-glow ${isImp ? "imposter" : "investigator"}" style="max-width:350px;width:100%;">
              <div style="font-size:54px;">${isImp ? "😈🔪" : "🕵️‍♂️🔍"}</div>
              <div style="font-size:27px;font-weight:900;color:${isImp ? "#FF6B86" : "#67E8F9"};margin-top:4px;">
                ${isImp ? "إنت الغدّار" : "إنت المحقق"}
              </div>
              <p style="font-size:12.5px;color:var(--text);font-weight:700;line-height:1.75;margin:10px 0;">
                ${isImp
                  ? "صفحتك الحمرا فيها رادار صيد وألاعيب تشويش وتكتيم للمحلل! صفّيهم واحد ورا التاني بس امشي طبيعي!"
                  : "صفحتك السماوية فيها شريط القضية وأدوات التحقيق! خلّص المهام، راقب المحلل، واطرد الغدّار!"}
              </p>
              ${vis.imposterPartners.length ? `
                <div class="pill" style="background:var(--crimson-soft);color:#FF6B86;margin-bottom:10px;">
                  شريكك الغدّار: ${esc(vis.imposterPartners.map((x) => x.name).join("، "))}
                </div>
              ` : ""}
              <button class="btn ${isImp ? "btn-danger" : "btn-cyan"}" style="width:100%;margin-top:8px;padding:13px;" onclick="onAcceptRoleCard()">يلا نبدأ التشتيت! 🔥</button>
            </div>
          `}
        </div>
      `;
      return;
    }

    // 2. Eliminated Alert (Center Focus)
    if (st.modal === "eliminated" && st.engine) {
      const self = st.engine.getVisibleStateForPlayer(st.user.id).self;
      const reasonMap = {
        KILLED_BY_IMPOSTER: "الغدّار فنشّك من ضهرك يا عيني! 🔪",
        OUTSIDE_ZONE: "الزون كلتك عشان اتأخرت برّاها! ⭕",
        EJECTED_IN_MEETING: "صحابك لبّسوك التهمة وطردوك في التصويت! 🗳️",
        CAUGHT_BY_SPOKEN_NAME: "محقق قفشك بالاسم وطيّرك! 🗣️",
      };
      mr.innerHTML = `
        <div class="center-modal-backdrop">
          <div class="card" style="max-width:340px;width:100%;text-align:center;border-color:var(--crimson);">
            <div style="font-size:48px;">💀👻</div>
            <div style="font-size:22px;font-weight:900;color:#FF6B86;">خرجت من الجيم!</div>
            <p style="font-size:13px;font-weight:700;color:var(--text);margin:10px 0;">${reasonMap[self.eliminationReason] || "تم إقصاؤك من الميدان!"}</p>
            <button class="btn btn-outline" style="width:100%;margin-top:8px;" onclick="onCloseModal()">ادخل وضع الشبح 👻</button>
          </div>
        </div>
      `;
      return;
    }

    // 3. Missions / Cover Alibis Bottom Sheet (Role-Separated!)
    if (st.modal === "missions_sheet" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isImp = vis.self.role === "IMPOSTER";
      const subtitle = isImp
        ? `<div style="font-size:11.5px;color:var(--muted);font-weight:700;">مهام تمويه اختيارية بتديك نقط لألاعيبك وبتبعد الشكوك عنك.</div>`
        : `<div style="font-size:11.5px;color:#67E8F9;font-weight:800;">🔍 تقدم القضية: ${vis.investigationDone} / ${vis.investigationGoal} — لو وصلت 100% بتكسبوا الجيم!</div>`;
      mr.innerHTML = bottomSheetHtml(
        isImp ? "🎭 تمثيليات التمويه (للغدّار)" : "🎯 مهام التحقيق (للمحقق)",
        `${subtitle}<div id="missions-sheet-list" style="display:flex;flex-direction:column;gap:9px;">${buildMissionsCardsHtml(vis)}</div>`,
        isImp ? "#FF6B86" : "#67E8F9"
      );
      return;
    }

    // 4. IMPOSTER-ONLY POWERS BOTTOM SHEET (ألاعيب الغدار فقط)
    if (st.modal === "imposter_powers" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        <div style="font-size:11.5px;color:var(--muted);font-weight:700;">رصيدك الحالي: <b style="color:#FDE68A;">${vis.self.points} نقطة</b></div>
        <button class="power-tile" onclick="onUseAbility('STEALTH')" ${vis.self.stealthUsesRemaining <= 0 ? "disabled" : ""}>
          <div>
            <div style="font-weight:900;font-size:13.5px;">👻 طاقية الإخفاء</div>
            <div style="font-size:11px;color:var(--muted);">متبانش على الخريطة في الرادار الجاي</div>
          </div>
          <span class="pill" style="background:var(--green-soft);color:#6EE7B7;">مجاني (${vis.self.stealthUsesRemaining})</span>
        </button>
        <button class="power-tile" style="border-color:rgba(255,46,84,0.4);" onclick="onUseAbility('BLOODHOUND')">
          <div>
            <div style="font-weight:900;font-size:13.5px;color:#FF6B86;">🩸 رادار الصيد</div>
            <div style="font-size:11px;color:var(--muted);">يقولك اسم ومكان ومسافة أقرب محقق!</div>
          </div>
          <span class="pill" style="background:var(--crimson-soft);color:#FF6B86;">${C.BLOODHOUND_COST}ن</span>
        </button>
        <button class="power-tile" onclick="onUseAbility('PLANT_RUMOR')">
          <div>
            <div style="font-weight:900;font-size:13.5px;color:#FDE68A;">🎭 تسريب إشاعة مضللة</div>
            <div style="font-size:11px;color:var(--muted);">يبعت تقرير وهمي للمحلل يشتّت المحققين</div>
          </div>
          <span class="pill" style="background:var(--gold-soft);color:#FDE68A;">${C.PLANT_RUMOR_COST}ن</span>
        </button>
        <button class="power-tile" onclick="onUseAbility('DECOY')">
          <div>
            <div style="font-weight:900;font-size:13.5px;">📡 إشارة حمرا وهمية</div>
            <div style="font-size:11px;color:var(--muted);">ترمي نقطة حمرا في حتة تانية 15 ثانية</div>
          </div>
          <span class="pill" style="background:var(--crimson-soft);color:#FDA4AF;">${C.DECOY_COST}ن</span>
        </button>
        <button class="power-tile" style="border-color:rgba(255,46,84,0.55);background:rgba(110,21,23,0.32);" onclick="onUseAbility('JAMMER')">
          <div>
            <div style="font-weight:900;font-size:13.5px;color:#fff;">⚡ تكتيم المحلل وفصل الرادار</div>
            <div style="font-size:11px;color:#FDA4AF;">يفصل الرادار ويكتم الـ AI لمدة 75 ثانية!</div>
          </div>
          <span class="pill" style="background:var(--crimson);color:#fff;">${C.JAMMER_COST}ن</span>
        </button>
      `;
      mr.innerHTML = bottomSheetHtml("😈 ألاعيب الغدّار", body, "#FF6B86");
      return;
    }

    // 5. INVESTIGATOR-ONLY POWERS BOTTOM SHEET (أدوات المحقق فقط)
    if (st.modal === "investigator_powers" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        <div style="font-size:11.5px;color:var(--muted);font-weight:700;">رصيدك الحالي: <b style="color:#67E8F9;">${vis.self.points} نقطة</b></div>
        <button class="power-tile" onclick="onUseAbility('STEALTH')" ${vis.self.stealthUsesRemaining <= 0 ? "disabled" : ""}>
          <div>
            <div style="font-weight:900;font-size:13.5px;">👻 طاقية الإخفاء</div>
            <div style="font-size:11px;color:var(--muted);">متبانش للغدّار في الرادار الجاي</div>
          </div>
          <span class="pill" style="background:var(--green-soft);color:#6EE7B7;">مجاني (${vis.self.stealthUsesRemaining})</span>
        </button>
        <button class="power-tile" style="border-color:rgba(0,212,255,0.4);" onclick="onUseAbility('PROTECT')">
          <div>
            <div style="font-weight:900;font-size:13.5px;color:#67E8F9;">🛡️ درع الحماية (15 ثانية)</div>
            <div style="font-size:11px;color:var(--muted);">يحميك من التفنيش لو شاكك إن الغدّار وراك!</div>
          </div>
          <span class="pill" style="background:var(--cyan-soft);color:#67E8F9;">${C.PROTECTION_COST}ن</span>
        </button>
        <div style="background:var(--surface-2);padding:11px;border-radius:16px;border:1px solid var(--border);">
          <div style="font-size:12px;font-weight:900;color:#67E8F9;margin-bottom:7px;">📡 مسح معلم من الخريطة (${C.LOCATION_QUESTION_COST}ن — تعرف مين قريب منه):</div>
          <div class="grid-2" style="gap:6px;">
            ${(vis.landmarks || []).map((lm) =>
              `<button class="btn btn-outline btn-xs" style="justify-content:flex-start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" onclick="onScanPlace('${esc(lm.id)}')">📍 ${esc(lm.name)}</button>`
            ).join("")}
          </div>
        </div>
        <button class="power-tile" style="border-color:rgba(255,176,32,0.5);background:rgba(255,176,32,0.1);" onclick="onUseAbility('BOLD_HINT')">
          <div>
            <div style="font-weight:900;font-size:13.5px;color:#FDE68A;">🔥 تلميح تقيل عن الغدّار</div>
            <div style="font-size:11px;color:var(--muted);">المحلل يهمسلك الغدّار قريب من أنهي مكان وبعيد كام متر!</div>
          </div>
          <span class="pill" style="background:var(--gold);color:#05070B;">${C.BOLD_HINT_COST}ن</span>
        </button>
      `;
      mr.innerHTML = bottomSheetHtml("🛡️ شنطة أدوات المحقق", body, "#67E8F9");
      return;
    }

    // 6. Broker Secret Deal Bottom Sheet (Role-Specific!)
    if (st.modal === "broker" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isImp = vis.self.role === "IMPOSTER";
      const body = `
        <p style="font-size:12.5px;font-weight:700;line-height:1.7;margin:0;">
          اختار صفقة واحدة.. <span style="color:#FF6B86;">التمن في الحالتين: مكانك هينور بالأحمر على خريطة الكل لمدة 15 ثانية!</span>
        </p>
        <button class="btn btn-warning" onclick="onAcceptBroker('intel')">
          ${isImp ? "🩸 اكشف مكان ومسافة أقرب صيدة (محقق)" : "🎯 اكشف مكان ومسافة أقرب غدّار"}
        </button>
        <button class="btn btn-success" onclick="onAcceptBroker('cash')">💰 خد +${C.BROKER_CASH_REWARD} نقطة كاش فوراً</button>
        <button class="btn btn-outline" onclick="onCloseModal()">فكك مني 😅</button>
      `;
      mr.innerHTML = bottomSheetHtml("🤝 صفقة السمسار السرية", body, "#FDE68A");
      return;
    }

    // 7. High-Stakes Direct Accusation (Investigator Only!)
    if (st.modal === "spoken" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        <div class="intel-item" style="border-color:var(--gold);background:var(--gold-soft);color:#FDE68A;">
          ⚠️ لو متأكد مين الغدّار اختاره وهيخرج فوراً! بس لو طلع بريء هتخسر <b>${C.SPOKEN_PENALTY_POINTS} نقطة</b> ومكانك هيتكشف بالأحمر 10 ثواني!
        </div>
        ${vis.players.filter((p) => p.alive && p.id !== vis.self.id).map((p) => `
          <button class="power-tile" onclick="onSpokenName('${p.id}')">
            <div style="display:flex;align-items:center;gap:10px;">
              ${avatarBadge(p.name)}
              <span style="font-weight:800;font-size:14px;">${esc(p.name)}</span>
            </div>
            <span class="pill" style="background:var(--crimson-soft);color:#FF6B86;">اتهام 🔥</span>
          </button>
        `).join("")}
      `;
      mr.innerHTML = bottomSheetHtml("🗣️ قفشة مباشرة للغدّار", body, "#67E8F9");
      return;
    }

    // 8. Full AI Profiler Log Bottom Sheet
    if (st.modal === "intel_log" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const body = `
        ${vis.aiReports.length
          ? [...vis.aiReports].reverse().map((r) => `
              <div class="intel-item">
                <div style="font-size:10px;color:#FDA4AF;margin-bottom:2px;">${r.source === "groq" ? "🤖 Groq AI لايف" : "📡 رادار التحليل"}</div>
                ${esc(r.summaryText)}
              </div>
            `).join("")
          : `<div style="font-size:12px;color:var(--muted);text-align:center;padding:12px;">المحلل بيراقب حركتكم.. أول تقرير هينزل بعد 85 ثانية من بداية اللعب!</div>`
        }
        <div class="section-label" style="margin-top:4px;">📋 آخر أحداث الميدان</div>
        ${[...vis.events].reverse().slice(0, 14).map((e) => `
          <div style="background:var(--surface-2);padding:8px 11px;border-radius:12px;font-size:11.5px;font-weight:700;">${esc(e.message)}</div>
        `).join("")}
      `;
      mr.innerHTML = bottomSheetHtml("🤖 سجل المحلل النفسي", body);
      return;
    }

    // 9. Simulation Lab Controls Bottom Sheet (keeps main map 100% clean!)
    if (st.modal === "sim_tools" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isSpread = vis.phase === "SPREAD";
      const body = `
        <div class="grid-2">
          <button class="btn btn-primary btn-sm" onclick="onSimToggleRole();onCloseModal()">🎭 بدّل الدور (غدّار / محقق)</button>
          <button class="btn btn-cyan btn-sm" onclick="onToggleSimDpad();onCloseModal()">${st.simDpadVisible ? "أخفي أسهم التحريك" : "🕹️ أظهر أسهم التحريك"}</button>
          <button class="btn btn-soft btn-sm" onclick="cycleSimSpeed();Kameen.UI.renderModal()">⏩ سرعة المحاكاة: ${st.simSpeed}x</button>
          ${isSpread
            ? `<button class="btn btn-warning btn-sm" onclick="onSimSkipSpread();onCloseModal()">⚡ تخطي التشتيت</button>`
            : `<button class="btn btn-outline btn-sm" onclick="onSimForceAI();onCloseModal()">🤖 تقرير AI دلوقتي</button>`}
          <button class="btn btn-outline btn-sm" ${isSpread ? "disabled" : ""} onclick="onSimSpawnAirdrop();onCloseModal()">💼 نزّل شنطة إمداد</button>
          <button class="btn btn-outline btn-sm" ${isSpread ? "disabled" : ""} onclick="onSimTriggerBroker();onCloseModal()">🤝 نزّل صفقة سمسار</button>
          <button class="btn btn-outline btn-sm" onclick="onSimShrinkZone();onCloseModal()">⭕ صغّر الزون 25%</button>
          <button class="btn btn-outline btn-sm" ${isSpread ? "disabled" : ""} onclick="onSimRadar();onCloseModal()">📡 شغّل الرادار</button>
        </div>
        <button class="btn btn-danger btn-sm" style="width:100%;margin-top:4px;" onclick="exitGameToLanding()">🚪 إنهاء المحاكاة والرجوع للرئيسية</button>
      `;
      mr.innerHTML = bottomSheetHtml("🧪 أدوات مختبر المحاكاة", body, "#FDE68A");
      return;
    }

    // 10. Permissions & Keys Settings Bottom Sheet
    if (st.modal === "permissions") {
      const gpsTxt = formatGpsStatusText();
      const hasKey = Boolean((st.groqKey || "").trim());
      const body = `
        <div class="power-tile" style="cursor:default;">
          <div>
            <div style="font-size:12.5px;font-weight:800;">الموقع الجغرافي (GPS)</div>
            <div id="perm-gps-sub" style="font-size:11px;color:var(--muted);">${esc(gpsTxt)}</div>
          </div>
          <button id="perm-gps-btn" class="btn btn-primary btn-xs" onclick="onRecalibrateGps()">${st.gps.status === "granted" ? "معايرة 📡" : "تفعيل GPS"}</button>
        </div>
        <div class="power-tile" style="cursor:default;">
          <div>
            <div style="font-size:12.5px;font-weight:800;">البوصلة ومخروط الاتجاه 🧭</div>
            <div style="font-size:11px;color:var(--muted);">${st.gps.compassActive ? "شغالة لايف ✅ (" + K.App.headingToArabic(st.gps.heading) + ")" : "بتوريّك أنت باصص فين ع الخريطة"}</div>
          </div>
          <button class="btn btn-cyan btn-xs" onclick="onEnableCompass()">تفعيل 🧭</button>
        </div>
        <div class="power-tile" style="cursor:default;">
          <span style="font-size:12.5px;font-weight:800;">الكاميرا (لتوثيق المهام)</span>
          <button id="perm-cam-btn" class="btn btn-primary btn-xs" onclick="void Kameen.App.requestCameraPerm()">${st.camera.status === "granted" ? "جاهزة ✅" : "تفعيل"}</button>
        </div>
        <div style="background:var(--surface-2);padding:11px 12px;border-radius:16px;border:1px solid var(--border);">
          <div style="font-size:11px;font-weight:800;margin-bottom:5px;color:${hasKey ? "#6EE7B7" : "#FDE68A"};">
            ${hasKey ? "مفتاح Groq AI محفوظ على موبايلك ✅" : "مفتاح Groq AI (الصقه هنا مرة واحدة — مش بيترفع على GitHub):"}
          </div>
          <input class="input" style="padding:9px 11px;font-size:11.5px;direction:ltr;" type="password"
            placeholder="gsk_..."
            value="${esc(st.groqKey)}"
            oninput="Kameen.state.groqKey=this.value;try{localStorage.setItem('kameen_groq_key',this.value)}catch{}" />
        </div>
        <button class="btn btn-primary" style="width:100%;" onclick="Kameen.App.startRealGps();onCloseModal();if(Kameen.state.route==='landing')Kameen.UI.renderPage()">حفظ وإغلاق 🔥</button>
      `;
      mr.innerHTML = bottomSheetHtml("⚙️ إعدادات التطبيق", body);
      return;
    }

    // 11. Mission Camera Proof Bottom Sheet
    if (st.modal === "camera" && st.engine) {
      const body = `
        <p style="font-size:12px;color:var(--muted);font-weight:700;margin:0;text-align:center;">
          صوّر <b>صورة سريعة</b> أو <b>فيديو قصير</b> للمكان.. Groq Vision هيتأكد إنه حقيقي وبعدها الملف بيتمسح تلقائي.
        </p>
        <div id="cam-verdict-box" class="${st.videoVerdict ? "" : "hidden"}"
          style="background:var(--crimson-soft);color:#FDA4AF;padding:10px;border-radius:13px;font-size:12px;font-weight:800;text-align:center;">
          ${esc(st.videoVerdict || "")}
        </div>
        <label class="btn btn-primary" style="width:100%;cursor:pointer;padding:14px;">
          <span id="cam-upload-lbl">${st.videoAnalyzing ? "⏳ الذكاء الاصطناعي بيفحص اللقطة..." : "📸 صوّر صورة أو فيديو سريع"}</span>
          <input type="file" accept="image/*,video/*" capture="environment" style="display:none;"
            onchange="if(this.files&&this.files[0])void Kameen.AI.analyzeMissionMedia(Kameen.state.activeCameraMissionId, this.files[0])" />
        </label>
      `;
      mr.innerHTML = bottomSheetHtml("📸 توثيق المهمة بالذكاء الاصطناعي", body);
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
  };
})(window.Kameen);
