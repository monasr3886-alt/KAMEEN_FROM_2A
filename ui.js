"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  const esc = K.escHtml;
  const fmt = K.fmtClock;

  function updateGpsStatusDOM() {
    const st = K.state;
    const gpsTxt = st.gps.accuracy
      ? `GPS شغال (±${st.gps.accuracy}م) 🟢`
      : (st.gps.error || "بيدور على إشارة GPS... 🟡");
    const lEl = document.getElementById("landing-gps-text");
    if (lEl) lEl.textContent = gpsTxt;
    const pSub = document.getElementById("perm-gps-sub");
    if (pSub) pSub.textContent = gpsTxt;
    const pBtn = document.getElementById("perm-gps-btn");
    if (pBtn) pBtn.textContent = st.gps.status === "granted" ? "متصل ✅" : "تفعيل GPS";
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

  function updateHudOnly() {
    const st = K.state;
    const topEl = document.getElementById("map-hud-top");
    const botEl = document.getElementById("map-hud-bottom");
    if (!topEl || !botEl) return;

    const styleLabels = { dark: "ليلي 🌑", satellite: "قمر 🛰️", street: "شوارع 🗺️", radar: "رادار 📡" };
    const styleLabel = styleLabels[st.mapStyle] || "خريطة";

    renderSimDpad();

    if (st.route === "create") {
      if (K.isUserTyping() && document.activeElement.id === "create-title-inp") return;
      const f = st.createForm;
      topEl.innerHTML = `
        <div class="hud-glass" style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
          <button class="btn btn-outline btn-sm" onclick="onNav('landing')">رجوع</button>
          <span style="font-size:12px;font-weight:900;">اضغط ع الخريطة تحدّد الزون 📍</span>
          <div style="display:flex;gap:5px;">
            <button class="btn btn-soft btn-sm" onclick="Kameen.Map.cycleStyle()">${styleLabel}</button>
            <button class="btn btn-outline btn-sm" onclick="onUseMyLocationForZone()">موقعي</button>
          </div>
        </div>
      `;
      botEl.innerHTML = `
        <div class="hud-glass" style="padding:12px;display:flex;flex-direction:column;gap:9px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span id="create-radius-lbl" style="font-size:12px;font-weight:900;">نصف القطر: <span style="color:var(--warning);">${f.radius}م</span> • ${f.pois.length} نقطة (${esc(f.poiSource || "جاهز")})</span>
            <button class="btn btn-outline btn-xs" onclick="onToggleCreatePanel()">${f.panelCollapsed ? "الإعدادات ⬆️" : "إخفاء ⬇️"}</button>
          </div>
          <input type="range" min="100" max="800" step="25" value="${f.radius}" style="width:100%;accent-color:var(--danger);"
            oninput="onRadiusSlide(this.value)"
            onchange="void Kameen.Map.fetchOverpassPOIs(Kameen.state.createForm.center, Kameen.state.createForm.radius)" />
          ${!f.panelCollapsed ? `
            <input id="create-title-inp" class="input" style="padding:8px 11px;font-size:12px;" value="${esc(f.title)}"
              oninput="Kameen.state.createForm.title=this.value" placeholder="اسم الجيم (مثال: كمين شارع 9)" />
            <div class="grid-3">
              <div>
                <div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:3px;">مدة الجيم</div>
                <div class="grid-3" style="gap:3px;">
                  ${[10, 15, 20].map((d) => `<button class="seg-btn ${f.duration===d?'active':''}" onclick="onSetCreateField('duration',${d})">${d}د</button>`).join("")}
                </div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:3px;">وقت التشتيت</div>
                <div class="grid-3" style="gap:3px;">
                  ${[30, 60, 120].map((s) => `<button class="seg-btn ${f.spreadSeconds===s?'active':''}" onclick="onSetCreateField('spreadSeconds',${s})">${s<60?s+'ث':(s/60)+'د'}</button>`).join("")}
                </div>
              </div>
              <div>
                <div style="font-size:10px;color:var(--muted);font-weight:800;margin-bottom:3px;">عدد الغدّارين</div>
                <div class="grid-2" style="gap:3px;">
                  ${[1, 2].map((n) => `<button class="seg-btn ${f.imposters===n?'active':''}" onclick="onSetCreateField('imposters',${n})">${n}</button>`).join("")}
                </div>
              </div>
            </div>
          ` : ""}
          <button class="btn btn-primary" style="width:100%;padding:12px;" onclick="onCreateMatch()">افتح اللوبي واعزم الشلة 🔥</button>
        </div>
      `;
      return;
    }

    if (!st.engine) return;
    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const snap = st.engine.getSnapshot();
    const C = K.GAME_CONSTANTS;
    const isImp = vis.self.role === "IMPOSTER";
    const isSpread = vis.phase === "SPREAD";
    const isAlive = vis.self.alive;

    const activeMission = vis.missions.find((m) => m.status === "in_progress");
    const activeDist = activeMission
      ? Math.round(K.Geo.distanceMeters(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng }))
      : null;

    const nearbyBody = vis.bodies.find((b) => !b.reported && K.Geo.distanceMeters(vis.self.coords, b.coords) <= C.REPORT_BODY_DISTANCE_M + 4);

    const nearestInv = Object.values(snap.players)
      .filter((p) => p.alive && p.role === "INVESTIGATOR")
      .sort((a, b) => K.Geo.distanceMeters(vis.self.coords, a.coords) - K.Geo.distanceMeters(vis.self.coords, b.coords))[0];
    const nearestInvDist = nearestInv ? Math.round(K.Geo.distanceMeters(vis.self.coords, nearestInv.coords)) : Infinity;
    const killCdSec = Math.max(0, Math.ceil((vis.self.killCooldownUntilMs - vis.nowMs) / 1000));

    const brokerActive = vis.activeBrokerOffer &&
      vis.nowMs < vis.activeBrokerOffer.expiresAtMs &&
      isAlive &&
      !vis.activeBrokerOffer.acceptedByPlayerIds.includes(vis.self.id);
    const brokerRem = brokerActive ? Math.ceil((vis.activeBrokerOffer.expiresAtMs - vis.nowMs) / 1000) : 0;

    const drop = vis.activeAirdrop;
    const dropDist = drop ? Math.round(K.Geo.distanceMeters(vis.self.coords, drop.coords)) : null;
    const dropCanClaim = drop && isAlive && dropDist <= C.AIRDROP_CLAIM_RANGE_M + 5;

    topEl.innerHTML = `
      <div class="hud-glass" style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span class="pill" style="background:${!isAlive ? 'rgba(100,116,139,0.28)' : (isImp ? 'var(--danger-soft)' : 'var(--brand-soft)')};color:${!isAlive ? '#CBD5E1' : (isImp ? '#FB7185' : '#FCA5A5')};">
          ${!isAlive ? 'شبح 👻' : (isImp ? 'الغدّار 🔪' : 'مفتش 🕵️')} • ${vis.self.points}ن
        </span>
        <div style="text-align:center;">
          <div style="font-weight:900;font-size:13px;line-height:1.1;">
            ${isSpread ? 'تشتيت ' + fmt(vis.spreadRemainingMs) : fmt(vis.remainingMatchMs)}
          </div>
          <div style="font-size:9px;color:var(--muted);font-weight:700;">
            أحياء: ${vis.players.filter((p) => p.alive).length} • الزون: ${vis.zone.currentRadiusMeters}م
          </div>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="btn btn-outline btn-xs" onclick="Kameen.SFX.toggle();Kameen.UI.updateHudOnly()">${K.SFX.muted ? '🔇' : '🔊'}</button>
          <button class="btn btn-outline btn-xs" onclick="Kameen.Map.cycleStyle()">${styleLabel}</button>
          <button class="btn btn-outline btn-xs" onclick="Kameen.Map.recenter()">📍</button>
        </div>
      </div>

      ${vis.showdownActive ? `<div class="showdown-strip">🔥 الخاتمة السخنة! الرادار كل 45ث وتهدئة التفنيش قلت للنص! 🔥</div>` : ""}
      ${vis.aiJammed ? `<div style="background:rgba(15,23,42,0.92);border:1px solid var(--info);color:#7DD3FC;text-align:center;padding:6px;border-radius:12px;font-size:11px;font-weight:800;">⚡ في تشويش إلكتروني! المحلل والرادار مفصولين مؤقتاً!</div>` : ""}
      ${!isAlive ? `<div style="background:rgba(15,23,42,0.92);border:1px solid #64748B;color:#E2E8F0;text-align:center;padding:7px;border-radius:13px;font-size:11px;font-weight:800;">👻 إنت في وضع الشبح — اتفرج على الجيم لحد ما يخلص!</div>` : ""}
      ${isSpread ? `<div style="background:rgba(15,23,42,0.92);border:1px solid var(--warning);color:#FDE68A;text-align:center;padding:7px;border-radius:13px;font-size:11px;font-weight:800;">🏃 وقت التشتيت! ابعدوا عن بعض بسرعة — التفنيش والمحلل لسه مقفولين</div>` : ""}
      ${vis.outsideZoneRemainingMs !== null ? `<div class="pulse-red" style="background:var(--danger);color:#fff;text-align:center;padding:8px;border-radius:13px;font-size:12px;font-weight:900;">⚠️ إنت برّه الزون يا بطل! ادخل خلال ${Math.ceil(vis.outsideZoneRemainingMs / 1000)} ثانية وإلا هتطير!</div>` : ""}
      ${vis.isRevealActive ? `<div style="background:linear-gradient(90deg,#991B1B,#E11D48);color:#fff;text-align:center;padding:7px;border-radius:13px;font-size:12px;font-weight:900;">📡 الرادار كاشف أماكن الكل لمدة ${Math.ceil(vis.revealRemainingMs / 1000)} ثانية!</div>` : ""}

      ${brokerActive ? `
        <button class="btn btn-warning pulse-gold" style="width:100%;padding:9px 12px;font-size:12px;" onclick="onOpenModal('broker')">
          🤝 صفقة سمسار سرية نزلت! الحقها بسرعة (${brokerRem}ث) 🔥
        </button>
      ` : ""}

      ${drop && isAlive ? `
        <div class="hud-glass" style="display:flex;justify-content:space-between;align-items:center;border-color:var(--warning);gap:8px;">
          <div style="font-size:11px;font-weight:800;color:#FDE68A;">
            💼 شنطة إمداد في ${esc(drop.sector)} (${dropDist}م ${K.Geo.getArabicDirection(vis.self.coords, drop.coords)})
          </div>
          ${dropCanClaim
            ? `<button class="btn btn-warning btn-xs pulse-gold" onclick="onClaimAirdrop()">القطها (+45ن) 🔥</button>`
            : `<span class="pill" style="background:var(--warning-soft);color:#FDE68A;">${Math.ceil((drop.expiresAtMs - vis.nowMs) / 1000)}ث</span>`
          }
        </div>
      ` : ""}

      ${isImp && isAlive && !isSpread && nearestInvDist <= C.NEARBY_TARGET_DISTANCE_M ? `
        <div style="background:rgba(244,63,94,0.92);color:#fff;text-align:center;padding:6px;border-radius:12px;font-size:11px;font-weight:900;">
          🎯 صيدة قريبة منك على بُعد ${nearestInvDist}م!
        </div>
      ` : ""}

      ${activeMission && isAlive ? `
        <div class="hud-glass" style="display:flex;justify-content:space-between;align-items:center;border-color:var(--warning);gap:8px;">
          <div style="min-width:0;">
            <div style="font-size:12px;font-weight:900;color:#FDE68A;">🎯 ${esc(activeMission.poi.name)}</div>
            <div style="font-size:11px;font-weight:700;color:var(--muted);">باقي ${activeDist}م ناحية الـ${K.Geo.getArabicDirection(vis.self.coords, { lat: activeMission.poi.lat, lng: activeMission.poi.lng })}</div>
          </div>
          <button class="btn btn-primary btn-sm" ${activeDist <= C.MISSION_RANGE_M + 5 ? "" : "disabled"}
            onclick="openCameraForMission('${activeMission.id}')">
            ${activeDist <= C.MISSION_RANGE_M + 5 ? "صوّر الإثبات 📸" : "قرّب بالـ GPS"}
          </button>
        </div>
      ` : ""}

      ${st.lastIntel ? `
        <div class="hud-glass" style="border-color:var(--danger);font-size:12px;font-weight:800;line-height:1.5;cursor:pointer;" onclick="onOpenModal('intel_log')">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
            <span>${esc(st.lastIntel)}</span>
            <span style="font-size:11px;color:var(--muted);flex-shrink:0;padding:2px 6px;" onclick="event.stopPropagation();Kameen.state.lastIntel=null;Kameen.UI.updateHudOnly()">✖</span>
          </div>
        </div>
      ` : ""}
    `;

    botEl.innerHTML = `
      <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
        ${isImp && isAlive && !isSpread && nearestInv ? `
          <button class="btn btn-danger" style="padding:11px 22px;font-size:14px;" ${killCdSec > 0 ? "disabled" : ""}
            onclick="onKillTarget('${nearestInv.id}')">
            ${killCdSec > 0 ? `تهدئة (${killCdSec}ث)` : `🔪 فنش! (${nearestInvDist}م)`}
          </button>
        ` : ""}
        ${isAlive && !isSpread && nearbyBody ? `
          <button class="btn btn-danger pulse-red" style="padding:11px 22px;font-size:14px;" onclick="onReportBody('${nearbyBody.id}')">
            🚨 بلّغ عن جثة ${esc(nearbyBody.victimName)}!
          </button>
        ` : ""}
      </div>

      ${st.route === "simulation" ? `
        <div class="hud-glass" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:5px;">
          <button class="btn btn-outline btn-xs" onclick="exitGameToLanding()">خروج</button>
          <button class="btn btn-soft btn-xs" onclick="cycleSimSpeed()">سرعة ${st.simSpeed}x</button>
          <button class="btn btn-outline btn-xs" onclick="onToggleSimDpad()">${st.simDpadVisible ? 'أخفي الأسهم' : '🕹️ أسهم'}</button>
          <button class="btn btn-outline btn-xs" onclick="onSimToggleRole()">بدّل الدور 🎭</button>
          ${isSpread ? `<button class="btn btn-warning btn-xs" onclick="onSimSkipSpread()">تخطي التشتيت ⚡</button>` : ""}
          <button class="btn btn-outline btn-xs" ${isSpread ? "disabled" : ""} onclick="onSimForceAI()">تقرير AI 🤖</button>
          <button class="btn btn-outline btn-xs" ${isSpread ? "disabled" : ""} onclick="onSimSpawnAirdrop()">إمداد 💼</button>
          <button class="btn btn-outline btn-xs" ${isSpread ? "disabled" : ""} onclick="onSimTriggerBroker()">سمسار 🤝</button>
          <button class="btn btn-outline btn-xs" onclick="onSimShrinkZone()">تقليص ⭕</button>
          <button class="btn btn-outline btn-xs" ${isSpread ? "disabled" : ""} onclick="onSimRadar()">رادار 📡</button>
        </div>
      ` : ""}

      <div class="hud-glass grid-4">
        <button class="btn btn-soft btn-xs" style="flex-direction:column;gap:2px;padding:7px 4px;" onclick="onNav('missions')">
          <span>🎯</span><span>المهام (${vis.missions.filter((m) => m.status === "completed").length}/3)</span>
        </button>
        <button class="btn btn-outline btn-xs" style="flex-direction:column;gap:2px;padding:7px 4px;" ${isSpread || !isAlive ? "disabled" : ""} onclick="onOpenModal('intel')">
          <span>⚡</span><span>قدرات (${vis.self.points})</span>
        </button>
        <button class="btn btn-outline btn-xs" style="flex-direction:column;gap:2px;padding:7px 4px;" onclick="onOpenModal('intel_log')">
          <span>🤖</span><span>المحلل (${vis.aiReports.length})</span>
        </button>
        ${isImp ? `
          <button class="btn btn-outline btn-xs" style="flex-direction:column;gap:2px;padding:7px 4px;" ${isSpread || !isAlive ? "disabled" : ""} onclick="onOpenModal('imposter_kit')">
            <span>😈</span><span>ألاعيب</span>
          </button>
        ` : `
          <button class="btn btn-outline btn-xs" style="flex-direction:column;gap:2px;padding:7px 4px;" ${isSpread || !isAlive ? "disabled" : ""} onclick="onOpenModal('spoken')">
            <span>🗣️</span><span>قفشت اسم</span>
          </button>
        `}
      </div>
    `;
  }

  function renderPage() {
    const st = K.state;
    const root = document.getElementById("page-root");
    if (!root) return;

    if (st.route === "landing") {
      const gpsTxt = st.gps.accuracy
        ? `GPS شغال (±${st.gps.accuracy}م) 🟢`
        : (st.gps.error || "بيدور على إشارة GPS... 🟡");
      root.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div style="display:flex;align-items:center;gap:10px;">
            <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-sm" alt="كمين" />
            <div>
              <div style="font-size:17px;font-weight:900;letter-spacing:0.3px;">كمين — KAMEEN</div>
              <div id="landing-gps-text" style="font-size:11px;font-weight:700;color:var(--muted);">${esc(gpsTxt)}</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-soft btn-sm" onclick="onOpenModal('permissions')">⚙️ إعدادات</button>
            <button class="btn btn-outline btn-sm" onclick="onNav('profile')">🏆 حسابي</button>
          </div>
        </div>

        <div class="card" style="display:flex;flex-direction:column;gap:12px;">
          <div class="hero-banner">
            <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="شعار كمين" />
            <div style="font-size:27px;font-weight:900;margin-top:6px;position:relative;z-index:1;">كمين</div>
            <div style="font-size:13px;color:#FCA5A5;font-weight:800;position:relative;z-index:1;">متأمنش لحد.. حتى صاحبك اللي ماشي جنبك! 👀</div>
            <div style="margin-top:10px;display:flex;justify-content:center;gap:6px;position:relative;z-index:1;">
              <span class="pill sb-status-badge" style="background:rgba(16,185,129,0.2);color:#6EE7B7;">سوبابيس جاهز 🟢</span>
              <span class="pill" style="background:rgba(56,189,248,0.18);color:#7DD3FC;">Groq AI شغال 🤖</span>
            </div>
          </div>

          <div>
            <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:4px;">اسمك في الميدان (عشان الشلة تعرفك):</div>
            <input id="player-name-input" class="input" type="text" value="${esc(st.user.name)}"
              oninput="Kameen.state.user.name=this.value;try{localStorage.setItem('kameen_name',this.value)}catch{}"
              placeholder="اكتب اسمك الروش..." />
          </div>

          <button class="btn btn-primary" style="width:100%;padding:13px;font-size:14px;" onclick="onStartCreateFlow()">
            🗺️ اعمل جيم جديد وحدد الزون في الحي
          </button>

          <div style="display:flex;gap:8px;">
            <input id="join-code-input" class="input" type="text" value="${esc(st.joinCode)}"
              oninput="Kameen.state.joinCode=this.value.toUpperCase()"
              onkeydown="if(event.key==='Enter')onJoinByInput()"
              placeholder="كود الروم (مثال KMN402)"
              style="flex:1;text-align:center;letter-spacing:1.5px;text-transform:uppercase;" />
            <button class="btn btn-outline" style="padding:0 18px;border-color:var(--danger);color:#FCA5A5;" onclick="onJoinByInput()">
              ادخل 🚀
            </button>
          </div>
        </div>

        <div class="grid-2">
          <button class="card" style="text-align:right;cursor:pointer;display:flex;flex-direction:column;gap:4px;" onclick="onStartSimulation()">
            <div style="font-weight:900;font-size:14px;color:#FDE68A;">🤖 جرب لوحدك (محاكاة)</div>
            <div style="font-size:11px;color:var(--muted);font-weight:700;">6 بوتات + أسهم تحريك + تجربة الغدّار والـ AI</div>
          </button>
          <button class="card" style="text-align:right;cursor:pointer;display:flex;flex-direction:column;gap:4px;" onclick="onNav('howto')">
            <div style="font-weight:900;font-size:14px;color:#7DD3FC;">📜 إزاي بنلعب؟</div>
            <div style="font-size:11px;color:var(--muted);font-weight:700;">شرح الغدّار، المحلل، الإمداد، والسمسار</div>
          </button>
        </div>
      `;
      K.Network.updateConnectionBadges();
      return;
    }

    if (st.route === "lobby" && st.lobby) {
      const l = st.lobby;
      const isHost = l.hostId === st.user.id;
      root.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="onLeaveLobby()">خروج</button>
          <div style="font-weight:900;font-size:15px;">${esc(l.title)}</div>
          <span class="pill sb-status-badge" style="background:var(--success-soft);color:#6EE7B7;">متصل 🟢</span>
        </div>

        <div class="card" style="text-align:center;">
          <div style="font-size:11px;color:var(--muted);font-weight:800;">ابعت الكود أو اللينك ده لصحابك عشان يدخلوا على طول:</div>
          <div style="font-size:34px;font-weight:900;letter-spacing:4px;color:#FCA5A5;margin:6px 0;">${esc(l.code)}</div>
          <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-top:8px;">
            <button class="btn btn-soft btn-sm" onclick="onCopyInviteCode()">📋 نسخ الكود</button>
            <button class="btn btn-success btn-sm" onclick="onShareWhatsApp()">💬 ابعت دعوة واتساب</button>
          </div>
          <div style="margin-top:8px;">
            <span class="pill" style="background:var(--surface-2);color:var(--muted);">زون ${l.radius}م • ${l.duration}د • ${l.imposters} غدّار</span>
          </div>
        </div>

        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-weight:900;font-size:14px;">الشلة اللي دخلت (${l.players.length})</span>
            ${isHost ? `<button class="btn btn-soft btn-sm" onclick="onAddBotToLobby()">+ ضيف بوت 🤖</button>` : ""}
          </div>
          <div style="display:flex;flex-direction:column;gap:7px;">
            ${l.players.map((p) => `
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);padding:10px 12px;border-radius:13px;font-size:13px;font-weight:800;">
                <span>${esc(p.name)} ${p.isHost ? '<span style="color:var(--warning);font-size:11px;">(الريس 👑)</span>' : ""}</span>
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="color:var(--success);font-size:11px;">جاهز ✅</span>
                  ${isHost && !p.isHost ? `<button class="btn btn-outline btn-xs" onclick="onKickLobbyPlayer('${p.id}')">✖</button>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>

        ${isHost
          ? `<button class="btn btn-primary" style="width:100%;padding:14px;font-size:15px;" onclick="onStartMatchFromLobby()">ابدأ الكمين دلوقتي! 🔥</button>`
          : `<div class="card" style="text-align:center;font-size:13px;font-weight:800;color:var(--warning);">⏳ مستنيين الريس يبدأ الجيم... استعد!</div>`
        }
      `;
      K.Network.updateConnectionBadges();
      return;
    }

    if (st.route === "missions" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      root.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="onNav(Kameen.state.isSimMode ? 'simulation' : 'game')">🗺️ ارجع للخريطة</button>
          <div style="font-weight:900;">مهامك في المنطقة</div>
          <span id="missions-points-pill" class="pill" style="background:var(--brand-soft);color:#FCA5A5;">${vis.self.points} نقطة</span>
        </div>
        <div id="missions-list-wrap" style="display:flex;flex-direction:column;gap:10px;">
          ${buildMissionsCardsHtml(vis)}
        </div>
      `;
      return;
    }

    if (st.route === "meeting" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const m = vis.activeMeeting;
      if (!m) return;
      const rem = Math.max(0, Math.ceil((m.endsAtMs - vis.nowMs) / 1000));
      root.innerHTML = `
        <div class="card" style="background:linear-gradient(135deg,#BE123C,#6E1517);border-color:#FB7185;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div>
              <div style="font-size:17px;font-weight:900;">🚨 اجتماع طارئ!</div>
              <div style="font-size:12px;font-weight:700;color:#FFE4E6;">${esc(m.triggeredByName)} لقى جثة ${esc(m.victimName || "ضحية")}!</div>
            </div>
            <span id="meeting-timer-badge" class="pill" style="background:rgba(0,0,0,0.38);color:#fff;font-size:14px;padding:6px 12px;">${rem}ث</span>
          </div>
        </div>

        <div class="card" style="padding:12px;">
          <div style="font-weight:900;font-size:12px;color:#FCA5A5;margin-bottom:6px;">🤖 آخر تقارير المحلل النفسي:</div>
          <div id="meeting-intel-feed" style="display:flex;flex-direction:column;gap:6px;max-height:95px;overflow-y:auto;">
            ${buildMeetingIntelHtml(vis)}
          </div>
        </div>

        <div class="card" style="padding:12px;">
          <div style="font-weight:900;font-size:12px;margin-bottom:6px;">💬 الخناقة المباشرة:</div>
          <div id="meeting-chat-feed" class="chat-box">
            ${buildMeetingChatHtml(m)}
          </div>
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
          ` : `<div style="font-size:11px;color:var(--muted);text-align:center;padding-top:6px;">👻 الأشباح بيتفرجوا بس ومبيتكلموش!</div>`}
        </div>

        <div class="card" style="padding:12px;">
          <div style="font-weight:900;font-size:13px;margin-bottom:8px;">🗳️ صوّت مين الغدّار (الأغلبية بتطرد):</div>
          <div id="meeting-votes-section">
            ${buildMeetingVotesHtml(vis)}
          </div>
        </div>
      `;
      return;
    }

    if (st.route === "result" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const invWin = vis.winner === "INVESTIGATORS";
      root.innerHTML = `
        <div class="card" style="background:${invWin ? 'linear-gradient(135deg,#047857,#064E3B)' : 'linear-gradient(135deg,#BE123C,#6E1517)'};text-align:center;padding:20px;">
          <div style="font-size:36px;">${invWin ? "🏆🕵️" : "😈🔪"}</div>
          <div style="font-size:23px;font-weight:900;margin-top:4px;">${invWin ? "مبروك للمفتشين!" : "الغدّارين كسبوا الجيم!"}</div>
          <div style="font-size:13px;font-weight:700;margin-top:6px;color:#F8FAFC;">${esc(vis.winReason || "")}</div>
        </div>

        <div id="ai-recap-box" class="card intel-item ${vis.aiMatchRecap ? '' : 'hidden'}" style="font-size:13px;">
          ${vis.aiMatchRecap ? "🤖 تعليق المحلل: " + esc(vis.aiMatchRecap) : ""}
        </div>

        ${vis.awards && vis.awards.length ? `
          <div class="card">
            <div style="font-weight:900;font-size:14px;margin-bottom:8px;">🏅 ألقاب الشلة في الجيم ده:</div>
            <div class="grid-2">
              ${vis.awards.map((a) => `
                <div class="award-card">
                  <div style="font-size:22px;">${a.icon}</div>
                  <div style="font-size:12px;font-weight:900;color:#FDE68A;">${esc(a.title)}</div>
                  <div style="font-size:13px;font-weight:800;">${esc(a.player)}</div>
                  <div style="font-size:10px;color:var(--muted);font-weight:700;">${esc(a.stat)}</div>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="card">
          <div style="font-weight:900;font-size:14px;margin-bottom:8px;">🎭 كشف المستور (الأدوار الحقيقية):</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${vis.players.map((p) => `
              <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);padding:9px 12px;border-radius:12px;font-size:13px;font-weight:800;">
                <span>${esc(p.name)}</span>
                <span class="pill" style="background:${p.role==='IMPOSTER'?'var(--danger-soft)':'var(--success-soft)'};color:${p.role==='IMPOSTER'?'#FB7185':'#6EE7B7'};">
                  ${p.role === "IMPOSTER" ? "غدّار 🔪" : "مفتش 🕵️"} • ${p.alive ? "عايش" : "طار 💀"}
                </span>
              </div>
            `).join("")}
          </div>
        </div>

        <div class="card">
          <div style="font-weight:900;font-size:13px;margin-bottom:8px;">💬 تصفية الحسابات بعد الجيم:</div>
          <div id="post-chat-list" class="chat-box" style="margin-bottom:8px;">
            ${buildPostChatHtml(vis.postChat)}
          </div>
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
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="onNav('landing')">رجوع</button>
          <div style="font-weight:900;">ملف العميل 🏆</div>
          <div style="width:52px;"></div>
        </div>
        <div class="card" style="text-align:center;">
          <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
          <div style="font-weight:900;font-size:20px;margin-top:8px;">${esc(u.name)}</div>
          <div class="grid-3" style="margin-top:14px;">
            <div style="background:var(--surface-2);padding:12px 6px;border-radius:14px;">
              <div style="font-size:20px;font-weight:900;color:#FCA5A5;">${u.matchesPlayed}</div>
              <div style="font-size:11px;color:var(--muted);font-weight:700;">مباريات</div>
            </div>
            <div style="background:var(--surface-2);padding:12px 6px;border-radius:14px;">
              <div style="font-size:20px;font-weight:900;color:var(--success);">${rate}%</div>
              <div style="font-size:11px;color:var(--muted);font-weight:700;">نسبة الفوز</div>
            </div>
            <div style="background:var(--surface-2);padding:12px 6px;border-radius:14px;">
              <div style="font-size:20px;font-weight:900;color:var(--warning);">${u.missionsCompleted}</div>
              <div style="font-size:11px;color:var(--muted);font-weight:700;">مهام</div>
            </div>
          </div>
        </div>
      `;
      return;
    }

    if (st.route === "howto") {
      root.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <button class="btn btn-outline btn-sm" onclick="onNav('landing')">رجوع</button>
          <div style="font-weight:900;">قوانين كمين 📜</div>
          <div style="width:52px;"></div>
        </div>
        <div class="card" style="font-size:13px;font-weight:700;line-height:1.9;display:flex;flex-direction:column;gap:9px;">
          <div>🗺️ <b>الزون والـ GPS:</b> الريس بيحدد دايرة اللعب في الحي، والزون بتصغر 25% كل 3 دقايق! اللي يفضل برّاها 20 ثانية بيطير.</div>
          <div>🎭 <b>الأدوار:</b> اللعبة بتوزّع الأدوار عشوائي: <b>الغدّار 🔪</b> (معاه تشويش رادار وتكتيم للمحلل!) والباقي <b>مفتشين 🕵️</b>.</div>
          <div>🤖 <b>المحلل النفسي (Groq AI):</b> كل 85 ثانية بيحلل سرعتكم وكمبرتكم وتقابلكم ويبعت تلميحات روشة بدون أسماء.. فمتجريش عشان متتفضحش!</div>
          <div>💼 <b>شنط الإمداد الذهبية:</b> بتنزل كل دقيقتين جوه الزون.. أول واحد يسبق ويقطفها بياخد +45 نقطة ودرع 10 ثواني!</div>
          <div>🤝 <b>صفقة السمسار السرية:</b> بتنزل مرتين في الجيم.. تختار تعرف مكان أقرب غدّار أو تاخد +60 نقطة كاش قصاد إن مكانك ينور أحمر 15 ثانية!</div>
          <div>🔥 <b>الخاتمة السخنة:</b> آخر دقيقتين في الجيم الرادار بيضرب كل 45 ثانية وتهدئة التفنيش بتقل للنص عشان النهاية تبقى نار!</div>
        </div>
      `;
    }
  }

  function buildMissionsCardsHtml(vis) {
    const C = K.GAME_CONSTANTS;
    return vis.missions.map((m) => {
      const dist = Math.round(K.Geo.distanceMeters(vis.self.coords, { lat: m.poi.lat, lng: m.poi.lng }));
      const dir = K.Geo.getArabicDirection(vis.self.coords, { lat: m.poi.lat, lng: m.poi.lng });
      const inRange = dist <= C.MISSION_RANGE_M + 5;
      return `
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div style="font-weight:900;font-size:15px;">${esc(m.title)}</div>
            <span class="pill" style="background:var(--warning-soft);color:#FDE68A;">+${m.rewardPoints} نقطة</span>
          </div>
          <p style="font-size:12px;color:var(--muted);font-weight:700;margin:6px 0 8px;">${esc(m.description)}</p>
          <div style="font-size:11px;font-weight:800;color:#7DD3FC;margin-bottom:10px;">
            📍 المسافة بالـ GPS: ${dist}م (${dir}) • المهلة: ${m.estimatedDurationSec}ث
          </div>
          ${m.status === "completed"
            ? `<div class="pill" style="background:var(--success-soft);color:#6EE7B7;width:100%;justify-content:center;padding:9px;">✅ خلصت واتوثقت بالذكاء الاصطناعي!</div>`
            : m.status === "pending"
              ? `<button class="btn btn-primary" style="width:100%;" onclick="onStartMission('${m.id}')">ابدأ المهمة وافتح الخط ع الخريطة 🎯</button>`
              : `<div style="display:flex;flex-direction:column;gap:7px;">
                  <button class="btn btn-soft" onclick="onNav(Kameen.state.isSimMode ? 'simulation' : 'game')">شوف المسار ع الخريطة (${dist}م متبقية)</button>
                  <button class="btn btn-success" ${inRange ? "" : "disabled"} onclick="openCameraForMission('${m.id}')">
                    ${inRange ? "📸 صوّر إثبات (صورة أو فيديو)" : `قرّب من المكان الأول (${dist}م / ${C.MISSION_RANGE_M}م)`}
                  </button>
                </div>`
          }
        </div>
      `;
    }).join("");
  }

  function updateMissionsDynamic() {
    if (!K.state.engine || K.isUserTyping()) return;
    const vis = K.state.engine.getVisibleStateForPlayer(K.state.user.id);
    const pEl = document.getElementById("missions-points-pill");
    if (pEl) pEl.textContent = vis.self.points + " نقطة";
    const wrap = document.getElementById("missions-list-wrap");
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
        <b style="color:${c.senderId === "system" ? "#FB7185" : "#FDE68A"};">${esc(c.senderName)}:</b>
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
            <button class="btn ${selected ? "btn-danger" : "btn-outline"}" ${!vis.self.alive ? "disabled" : ""}
              onclick="onCastVote('${p.id}')">
              <span>${esc(p.name)}</span>
              ${hasVoted ? '<span style="font-size:10px;">✅</span>' : ""}
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

  function renderModal() {
    const st = K.state;
    const mr = document.getElementById("modal-root");
    if (!mr) return;

    // 1. Secret Role Reveal Card
    if ((st.route === "game" || st.route === "simulation") && !st.roleRevealed && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      const isImp = vis.self.role === "IMPOSTER";
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:350px;width:100%;text-align:center;border-color:var(--danger);">
            ${!st.roleFlipped ? `
              <img src="${K.CONFIG.LOGO_PATH}" class="brand-logo-lg" alt="كمين" />
              <div style="font-size:20px;font-weight:900;margin-top:8px;">كارت الدور السري 🃏</div>
              <p style="font-size:13px;color:var(--muted);font-weight:700;">اتأكد محدش بيبص في موبايلك واضغط عشان تعرف إنت مين!</p>
              <button class="btn btn-primary" style="width:100%;margin-top:12px;padding:13px;" onclick="onFlipRoleCard()">اكشف دوري 👀</button>
            ` : `
              <div style="font-size:48px;">${isImp ? "😈🔪" : "🕵️‍♂️🔍"}</div>
              <div style="font-size:26px;font-weight:900;color:${isImp ? "#FB7185" : "#6EE7B7"};margin-top:4px;">
                ${isImp ? "إنت الغدّار (إمبوستر)" : "إنت مفتش (محقق)"}
              </div>
              <p style="font-size:12px;color:var(--text);font-weight:700;line-height:1.75;margin:10px 0;">
                ${isImp
                  ? "صفّيهم واحد ورا التاني من سكات.. بس امشي طبيعي ومتجريش عشان الذكاء الاصطناعي عينه عليك! ومعاك ألاعيب تشويش وتكتيم!"
                  : "خلّص مهامك، اسبق على شنط الإمداد، راقب تقارير المحلل النفسي، ولو لقيت جثة بلّغ فوراً واطرد الغدّار!"}
              </p>
              ${vis.imposterPartners.length ? `
                <div class="pill" style="background:var(--danger-soft);color:#FB7185;margin-bottom:10px;">
                  شريكك الغدّار: ${esc(vis.imposterPartners.map((x) => x.name).join("، "))}
                </div>
              ` : ""}
              <button class="btn btn-primary" style="width:100%;margin-top:8px;padding:13px;" onclick="onAcceptRoleCard()">فهمت — يلا نبدأ! 🔥</button>
            `}
          </div>
        </div>
      `;
      return;
    }

    // 2. Eliminated Alert -> Ghost Mode
    if (st.modal === "eliminated" && st.engine) {
      const self = st.engine.getVisibleStateForPlayer(st.user.id).self;
      const reasonMap = {
        KILLED_BY_IMPOSTER: "الغدّار فنشّك من ضهرك يا عيني! 🔪",
        OUTSIDE_ZONE: "الزون كلتك عشان اتأخرت برّاها! ⭕",
        EJECTED_IN_MEETING: "صحابك لبّسوك التهمة وطردوك في التصويت! 🗳️",
        CAUGHT_BY_SPOKEN_NAME: "مفتش قفشك بالاسم وطيّرك! 🗣️",
      };
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:340px;width:100%;text-align:center;border-color:var(--danger);">
            <div style="font-size:48px;">💀👻</div>
            <div style="font-size:22px;font-weight:900;color:#FB7185;">خرجت من الجيم!</div>
            <p style="font-size:13px;font-weight:700;color:var(--text);margin:10px 0;">${reasonMap[self.eliminationReason] || "تم إقصاؤك من الميدان!"}</p>
            <button class="btn btn-outline" style="width:100%;margin-top:8px;" onclick="onCloseModal()">اتفرج كـ شبح 👻</button>
          </div>
        </div>
      `;
      return;
    }

    // 3. Broker Secret Deal (2 Choices!)
    if (st.modal === "broker" && st.engine) {
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:365px;width:100%;text-align:center;border-color:var(--warning);display:flex;flex-direction:column;gap:10px;">
            <div style="font-size:40px;">🤝🔥</div>
            <div style="font-size:20px;font-weight:900;color:#FDE68A;">صفقة السمسار السرية</div>
            <p style="font-size:12px;font-weight:700;line-height:1.7;margin:0;">
              اختار صفقة واحدة.. <span style="color:#FB7185;">التمن في الحالتين: مكانك هينور بالأحمر على خريطة الكل لمدة 15 ثانية!</span>
            </p>
            <button class="btn btn-warning" onclick="onAcceptBroker('intel')">🎯 اعرف مسافة واتجاه أقرب غدّار</button>
            <button class="btn btn-success" onclick="onAcceptBroker('cash')">💰 خد +${K.GAME_CONSTANTS.BROKER_CASH_REWARD} نقطة كاش فوراً</button>
            <button class="btn btn-outline" onclick="onCloseModal()">فكك مني 😅</button>
          </div>
        </div>
      `;
      return;
    }

    // 4. Imposter Dirty Tricks Kit
    if (st.modal === "imposter_kit" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:365px;width:100%;display:flex;flex-direction:column;gap:9px;border-color:var(--danger);">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:900;font-size:15px;color:#FB7185;">😈 ألاعيب الغدّار (${vis.self.points}ن)</span>
              <button class="btn btn-outline btn-xs" onclick="onCloseModal()">إغلاق</button>
            </div>
            <button class="btn btn-soft" style="justify-content:space-between;" onclick="onUseAbility('DECOY')">
              <span>📡 تشويش رادار (إشارة حمرا وهمية 15ث)</span>
              <span class="pill" style="background:rgba(0,0,0,0.3);color:#FDE68A;">${K.GAME_CONSTANTS.DECOY_COST}ن</span>
            </button>
            <button class="btn btn-danger" style="justify-content:space-between;" onclick="onUseAbility('JAMMER')">
              <span>⚡ تكتيم المحلل وفصل الرادار (75ث!)</span>
              <span class="pill" style="background:rgba(0,0,0,0.3);color:#fff;">${K.GAME_CONSTANTS.JAMMER_COST}ن</span>
            </button>
          </div>
        </div>
      `;
      return;
    }

    // 5. Permissions & Keys Settings Modal
    if (st.modal === "permissions") {
      const gpsTxt = st.gps.accuracy ? `GPS شغال (±${st.gps.accuracy}م) 🟢` : (st.gps.error || "اضغط عشان نحدد مكانك");
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:370px;width:100%;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:16px;font-weight:900;">⚙️ إعدادات الـ GPS والذكاء الاصطناعي</span>
              <button class="btn btn-outline btn-xs" onclick="onCloseModal()">✖</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);padding:10px 12px;border-radius:14px;">
              <div>
                <div style="font-size:12px;font-weight:800;">الموقع الجغرافي (GPS)</div>
                <div id="perm-gps-sub" style="font-size:11px;color:var(--muted);">${esc(gpsTxt)}</div>
              </div>
              <button id="perm-gps-btn" class="btn btn-primary btn-xs" onclick="Kameen.App.startRealGps()">${st.gps.status === "granted" ? "متصل ✅" : "تفعيل GPS"}</button>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-2);padding:10px 12px;border-radius:14px;">
              <span style="font-size:12px;font-weight:800;">الكاميرا (عشان إثبات المهام)</span>
              <button id="perm-cam-btn" class="btn btn-primary btn-xs" onclick="void Kameen.App.requestCameraPerm()">${st.camera.status === "granted" ? "جاهزة ✅" : "تفعيل"}</button>
            </div>
            <div style="background:var(--surface-2);padding:10px 12px;border-radius:14px;">
              <div style="font-size:11px;font-weight:800;margin-bottom:5px;color:#7DD3FC;">مفتاح Groq AI (متحطوط وجاهز ✅):</div>
              <input class="input" style="padding:8px 10px;font-size:11px;direction:ltr;" type="password"
                value="${esc(st.groqKey)}"
                oninput="Kameen.state.groqKey=this.value;try{localStorage.setItem('kameen_groq_key',this.value)}catch{}" />
            </div>
            <button class="btn btn-primary" style="width:100%;" onclick="Kameen.App.startRealGps();onCloseModal()">تمام، ارجع للّعبة 🔥</button>
          </div>
        </div>
      `;
      return;
    }

    // 6. Abilities & Sector Scan Modal
    if (st.modal === "intel" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:370px;width:100%;display:flex;flex-direction:column;gap:8px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:900;font-size:15px;">⚡ قدراتك (${vis.self.points} نقطة)</span>
              <button class="btn btn-outline btn-xs" onclick="onCloseModal()">إغلاق</button>
            </div>
            <button class="btn btn-outline" style="justify-content:space-between;" onclick="onUseAbility('STEALTH')">
              <span>👻 طاقية الإخفاء (متبانش في الرادار الجاي)</span>
              <span class="pill" style="background:var(--success-soft);color:#6EE7B7;">مجاني (${vis.self.stealthUsesRemaining})</span>
            </button>
            <button class="btn btn-outline" style="justify-content:space-between;" onclick="onUseAbility('PROTECT')">
              <span>🛡️ درع حماية (12 ثانية ضد التفنيش)</span>
              <span class="pill" style="background:var(--warning-soft);color:#FDE68A;">10 نقط</span>
            </button>
            <button class="btn btn-soft" style="justify-content:space-between;" onclick="onUseAbility('MISLEAD')">
              <span>🕵️ إشاعة ع الماشي (معلومة مش مضمونة)</span>
              <span class="pill" style="background:rgba(0,0,0,0.3);color:#FCA5A5;">5 نقط</span>
            </button>
            <div style="background:var(--surface-2);padding:10px;border-radius:14px;">
              <div style="font-size:11px;font-weight:800;margin-bottom:6px;color:#7DD3FC;">📡 امسح قطاع معين (20 نقطة — تعرف فيه كام لاعب):</div>
              <div class="grid-3" style="gap:5px;">
                ${K.SECTORS.map((sec) =>
                  `<button class="btn btn-outline btn-xs" onclick="onScanSector('${sec}')">${sec.replace("القطاع ", "")}</button>`
                ).join("")}
              </div>
            </div>
            <button class="btn btn-danger" style="justify-content:space-between;" onclick="onUseAbility('BOLD_HINT')">
              <span>🔥 تلميح تقيل من المحلل (اتجاه ومسافة الغدّار!)</span>
              <span class="pill" style="background:rgba(0,0,0,0.3);color:#fff;">${K.GAME_CONSTANTS.BOLD_HINT_COST}ن</span>
            </button>
          </div>
        </div>
      `;
      return;
    }

    // 7. Full AI Intel Log Modal
    if (st.modal === "intel_log" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:370px;width:100%;max-height:80dvh;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-weight:900;font-size:15px;">🤖 سجل المحلل النفسي والأحداث</span>
              <button class="btn btn-outline btn-xs" onclick="onCloseModal()">إغلاق</button>
            </div>
            <div style="overflow-y:auto;display:flex;flex-direction:column;gap:7px;">
              ${vis.aiReports.length
                ? [...vis.aiReports].reverse().map((r) => `
                    <div class="intel-item">
                      <div style="font-size:10px;color:#FCA5A5;margin-bottom:2px;">${r.source === "groq" ? "🤖 Groq AI لايف" : "📡 رادار التحليل"}</div>
                      ${esc(r.summaryText)}
                    </div>
                  `).join("")
                : `<div style="font-size:12px;color:var(--muted);text-align:center;padding:12px;">المحلل بيراقب حركتكم.. أول تقرير هينزل بعد 85 ثانية من بداية اللعب!</div>`
              }
              <div style="font-size:11px;font-weight:900;color:var(--muted);margin-top:6px;">📋 آخر أحداث الميدان:</div>
              ${[...vis.events].reverse().slice(0, 14).map((e) => `
                <div style="background:var(--surface-2);padding:7px 10px;border-radius:10px;font-size:11px;font-weight:700;">${esc(e.message)}</div>
              `).join("")}
            </div>
          </div>
        </div>
      `;
      return;
    }

    // 8. Spoken Name Modal
    if (st.modal === "spoken" && st.engine) {
      const vis = st.engine.getVisibleStateForPlayer(st.user.id);
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:360px;width:100%;display:flex;flex-direction:column;gap:8px;">
            <div style="font-weight:900;font-size:15px;">🗣️ سمعت حد اتفضح أو متأكد مين الغدّار؟</div>
            <p style="font-size:11px;color:var(--muted);margin:0;">اختار اسمه — لو طلع هو الغدّار فعلاً هيطير في ساعتها!</p>
            <div style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;">
              ${vis.players.filter((p) => p.alive && p.id !== vis.self.id).map((p) => `
                <button class="btn btn-outline" onclick="onSpokenName('${p.id}')">${esc(p.name)}</button>
              `).join("")}
            </div>
            <button class="btn btn-soft" style="width:100%;" onclick="onCloseModal()">إلغاء</button>
          </div>
        </div>
      `;
      return;
    }

    // 9. Mission Proof Camera Modal (Photo OR Video!)
    if (st.modal === "camera" && st.engine) {
      mr.innerHTML = `
        <div class="modal-backdrop">
          <div class="card" style="max-width:360px;width:100%;text-align:center;display:flex;flex-direction:column;gap:10px;">
            <div style="font-size:38px;">📸🤖</div>
            <div style="font-weight:900;font-size:16px;">إثبات المهمة بالذكاء الاصطناعي</div>
            <p style="font-size:12px;color:var(--muted);font-weight:700;margin:0;">صوّر <b>صورة سريعة</b> أو <b>فيديو قصير</b> للمكان.. Groq Vision هيتأكد إنه حقيقي وبعدها الملف بيتمسح تلقائي.</p>
            <div id="cam-verdict-box" class="${st.videoVerdict ? "" : "hidden"}"
              style="background:var(--brand-soft);color:#FCA5A5;padding:9px;border-radius:12px;font-size:12px;font-weight:800;">
              ${esc(st.videoVerdict || "")}
            </div>
            <label class="btn btn-primary" style="width:100%;cursor:pointer;">
              <span id="cam-upload-lbl">${st.videoAnalyzing ? "⏳ الذكاء الاصطناعي بيفحص اللقطة..." : "📸 صوّر صورة أو فيديو سريع"}</span>
              <input type="file" accept="image/*,video/*" capture="environment" style="display:none;"
                onchange="if(this.files&&this.files[0])void Kameen.AI.analyzeMissionMedia(Kameen.state.activeCameraMissionId, this.files[0])" />
            </label>
            <button class="btn btn-outline" style="width:100%;" onclick="onCloseModal()">إلغاء</button>
          </div>
        </div>
      `;
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
