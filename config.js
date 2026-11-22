"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  K.CONFIG = {
    VERSION: "v5.1",
    LOGO_PATH: "./logo.jpg",
    DEFAULT_CENTER: { lat: 29.9753, lng: 30.9455, accuracyMeters: 6 },
    // الصق مفتاح Groq هنا لو هترفع مباشر على Vercel أو في Repo خاص (أو احفظه مرة واحدة من قائمة الإعدادات ☰)
    DEFAULT_GROQ_KEY: "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",
    SUPABASE_URL: "https://raxycqblimomlwfcwxml.supabase.co",
    SUPABASE_KEY: "sb_publishable_4Y6UnQ9dr4yoBPyme7smYg_7oTDlxKr",
  };

  K.GAME_CONSTANTS = {
    ZONE_SHRINK_INTERVAL_MS: 180000,   // كل 3 دقايق الزون تصغر 25%
    ZONE_SHRINK_FACTOR: 0.75,
    OUTSIDE_ZONE_GRACE_MS: 20000,      // 20 ثانية بره الزون وتطير
    ACTIVE_START_GRACE_MS: 20000,      // 20 ثانية أمان بعد التشتيت
    DEFAULT_REVEAL_INTERVAL_SEC: 120,  // الافتراضي: قراءة متجددة لكل اللاعبين كل دقيقتين (قابل للتعديل من الإعدادات)
    DEFAULT_REVEAL_MODE: "ping",       // "ping" = قراءة ثابتة تتجدد كل X دقيقة | "live" = تتبع لايف 15ث
    LIVE_REVEAL_DURATION_MS: 15000,
    SHOWDOWN_REVEAL_INTERVAL_MS: 45000,
    KILL_COOLDOWN_MS: 65000,
    SHOWDOWN_KILL_COOLDOWN_MS: 35000,
    KILL_BASE_DISTANCE_M: 8,
    NEARBY_TARGET_DISTANCE_M: 40,
    REPORT_BODY_DISTANCE_M: 20,
    MISSION_RANGE_M: 30,
    AIRDROP_INTERVAL_MS: 135000,
    AIRDROP_DURATION_MS: 75000,
    AIRDROP_CLAIM_RANGE_M: 24,
    AIRDROP_REWARD_POINTS: 45,
    // Investigator Powers
    PROTECTION_COST: 15,
    PROTECTION_DURATION_MS: 15000,
    LOCATION_QUESTION_COST: 20,
    PRIVATE_PROFILE_COST: 30,
    BOLD_HINT_COST: 60,
    SPOKEN_PENALTY_POINTS: 25,
    // Imposter Powers
    BLOODHOUND_COST: 20,
    IMP_INTEL_COST: 25,
    DECOY_COST: 25,
    DECOY_DURATION_MS: 15000,
    PLANT_RUMOR_COST: 15,
    JAMMER_COST: 35,
    JAMMER_DELAY_MS: 75000,
    // Broker Secret Deals
    BROKER_MINUTE_4_MS: 210000,
    BROKER_MINUTE_8_MS: 450000,
    BROKER_RED_BROADCAST_MS: 15000,
    BROKER_OFFER_WINDOW_MS: 35000,
    BROKER_CASH_REWARD: 60,
    AI_REPORT_INTERVAL_MS: 70000,
    MEETING_DURATION_MS: 120000,
    INITIAL_POINTS: 100,
  };

  K.AVATAR_COLORS = [
    "#EF233C", "#0284C7", "#D97706", "#10B981", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"
  ];

  K.BOT_NAMES = [
    "أبو حميد", "شيكا", "زيكو", "سيف", "كريم", "ميدو", "نور", "طارق", "حودة", "مريم"
  ];

  K.BOT_SLANG_LINES = [
    "والله العظيم ما أنا يا جدعان كنت رايح أخلص مهمتي!",
    "يا عم أنا لمحت واحد طار جري من قدامي من شوية!",
    "اللي ساكت ومش بيتكلم ده هو الغدّار على ضمانتي",
    "اقروا تقرير المحلل تاني يا رجالة شوفوا مين كان قريب من المكان!",
    "استنوا نعمل تخطي المرة دي عشان مفيش دليل أكيد.",
    "أنا كنت لوحدي بعيد ومكنش في حد جنبي خالص!",
    "يا جدعان في حد كان واقف مكانه بقاله حبة.. اعترف مين؟",
    "لو طردتوني هتندموا والغدّار هيكسب الجيم!",
  ];

  K.QUICK_CHAT_LINES = [
    "والله ما أنا!",
    "كنت بعمل مهمة",
    "شاكك في الساكت",
    "مين كان قريب من المكان؟",
    "تخطي يا جدعان",
    "اقفشوه هو الغدّار!"
  ];

  K.SFX = {
    ctx: null,
    muted: localStorage.getItem("kameen_muted") === "1",
    toggle() {
      this.muted = !this.muted;
      try { localStorage.setItem("kameen_muted", this.muted ? "1" : "0"); } catch {}
      if (!this.muted) this.play("click");
    },
    warmup() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) this.ctx = new AC();
        }
        if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
      } catch {}
    },
    play(type) {
      if (this.muted) return;
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) this.ctx = new AC();
        }
        if (!this.ctx) return;
        if (this.ctx.state === "suspended") this.ctx.resume();
        const now = this.ctx.currentTime;
        const tone = (freq, dur, delay = 0, wave = "sine", vol = 0.11) => {
          const osc = this.ctx.createOscillator();
          const gain = this.ctx.createGain();
          osc.type = wave;
          osc.frequency.setValueAtTime(freq, now + delay);
          gain.gain.setValueAtTime(vol, now + delay);
          gain.gain.exponentialRampToValueAtTime(0.001, now + delay + dur);
          osc.connect(gain);
          gain.connect(this.ctx.destination);
          osc.start(now + delay);
          osc.stop(now + delay + dur);
        };
        if (type === "intel") { tone(660, 0.10, 0); tone(920, 0.16, 0.11); }
        else if (type === "alarm") { tone(440, 0.20, 0, "sawtooth", 0.13); tone(320, 0.26, 0.22, "sawtooth", 0.13); if (navigator.vibrate) navigator.vibrate([160, 80, 200]); }
        else if (type === "kill") { tone(165, 0.30, 0, "square", 0.14); if (navigator.vibrate) navigator.vibrate([220, 90, 220]); }
        else if (type === "broker") { tone(520, 0.08, 0, "triangle"); tone(780, 0.10, 0.09, "triangle"); tone(1040, 0.18, 0.20, "triangle"); if (navigator.vibrate) navigator.vibrate([80, 50, 100]); }
        else if (type === "airdrop") { tone(587, 0.09, 0, "triangle"); tone(880, 0.16, 0.10, "triangle"); if (navigator.vibrate) navigator.vibrate([70, 45, 70]); }
        else if (type === "win") { tone(523, 0.12, 0); tone(659, 0.12, 0.13); tone(784, 0.22, 0.26); }
        else if (type === "radar") { tone(920, 0.08, 0, "sine", 0.065); tone(1380, 0.14, 0.08, "sine", 0.045); if (navigator.vibrate) navigator.vibrate(25); }
        else if (type === "heartbeat_warm") {
          tone(68, 0.10, 0, "sine", 0.13);
          tone(54, 0.12, 0.15, "sine", 0.09);
          if (navigator.vibrate) navigator.vibrate([28, 85, 22]);
        }
        else if (type === "heartbeat_crit") {
          tone(76, 0.10, 0, "triangle", 0.18);
          tone(58, 0.12, 0.13, "sine", 0.14);
          if (navigator.vibrate) navigator.vibrate([50, 70, 42]);
        }
        else if (type === "click") { tone(540, 0.035, 0, "sine", 0.05); if (navigator.vibrate) navigator.vibrate(8); }
      } catch {}
    }
  };

  K.WakeLock = {
    sentinel: null,
    async acquire() {
      try {
        if ("wakeLock" in navigator && !this.sentinel) {
          this.sentinel = await navigator.wakeLock.request("screen");
          this.sentinel.addEventListener("release", () => { this.sentinel = null; });
        }
      } catch {}
    },
    release() {
      try { if (this.sentinel) { this.sentinel.release(); this.sentinel = null; } } catch {}
    }
  };

  K.triggerShake = function () {
    document.body.classList.remove("screen-shake");
    void document.body.offsetWidth;
    document.body.classList.add("screen-shake");
    setTimeout(() => document.body.classList.remove("screen-shake"), 360);
  };

  K.setDangerVignette = function (active) {
    const el = document.getElementById("danger-vignette");
    if (el) el.classList.toggle("hidden", !active);
  };

  K.setBodyRoleTheme = function (roleTheme) {
    document.body.setAttribute("data-role", roleTheme || "neutral");
  };

  K.getAvatarColor = function (name) {
    let h = 0;
    const s = String(name || "X");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return K.AVATAR_COLORS[h % K.AVATAR_COLORS.length];
  };

  K.escHtml = function (str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  K.fmtClock = function (ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };

  K.isUserTyping = function () {
    const el = document.activeElement;
    return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT"));
  };

  K.loadStats = function () {
    try {
      return JSON.parse(localStorage.getItem("kameen_stats_v3") || "null") || { played: 0, won: 0, missions: 0, kills: 0 };
    } catch {
      return { played: 0, won: 0, missions: 0, kills: 0 };
    }
  };

  K.saveStats = function (s) {
    try { localStorage.setItem("kameen_stats_v3", JSON.stringify(s)); } catch {}
  };

  K.showToast = function (msg, ms = 3200) {
    if (!K.state) return;
    K.state.toast = msg;
    const root = document.getElementById("toast-root");
    if (root) root.innerHTML = `<div class="toast">${K.escHtml(msg)}</div>`;
    if (K.state.toastTimer) clearTimeout(K.state.toastTimer);
    K.state.toastTimer = setTimeout(() => {
      if (K.state) K.state.toast = null;
      if (root) root.innerHTML = "";
    }, ms);
  };
})(window.Kameen);
