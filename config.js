"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  K.CONFIG = {
    LOGO_PATH: "./logo.jpg",
    DEFAULT_CENTER: { lat: 29.9753, lng: 30.9455, accuracyMeters: 6 },
    DEFAULT_GROQ_KEY: "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",
    SUPABASE_URL: "https://raxycqblimomlwfcwxml.supabase.co",
    SUPABASE_KEY: "sb_publishable_4Y6UnQ9dr4yoBPyme7smYg_7oTDlxKr",
  };

  K.GAME_CONSTANTS = {
    ZONE_SHRINK_INTERVAL_MS: 180000,   // كل 3 دقايق الزون تصغر 25%
    ZONE_SHRINK_FACTOR: 0.75,
    OUTSIDE_ZONE_GRACE_MS: 20000,      // 20 ثانية بره الزون وتطير
    REVEAL_INTERVAL_MS: 180000,        // رادار كشف الأماكن كل 3 دقايق
    REVEAL_DURATION_MS: 20000,
    SHOWDOWN_REVEAL_INTERVAL_MS: 45000,// في الخاتمة السخنة: رادار كل 45 ثانية!
    SHOWDOWN_REVEAL_DURATION_MS: 8000,
    KILL_COOLDOWN_MS: 80000,           // 80 ثانية تهدئة (45ث في الخاتمة)
    SHOWDOWN_KILL_COOLDOWN_MS: 45000,
    KILL_BASE_DISTANCE_M: 8,
    NEARBY_TARGET_DISTANCE_M: 38,
    REPORT_BODY_DISTANCE_M: 20,
    MISSION_RANGE_M: 30,
    AIRDROP_INTERVAL_MS: 135000,       // شنطة إمداد ذهبية كل دقيقتين وربع!
    AIRDROP_DURATION_MS: 75000,
    AIRDROP_CLAIM_RANGE_M: 24,
    AIRDROP_REWARD_POINTS: 45,
    PROTECTION_COST: 10,
    PROTECTION_DURATION_MS: 12000,
    DECOY_COST: 25,
    DECOY_DURATION_MS: 15000,
    JAMMER_COST: 35,
    JAMMER_DELAY_MS: 75000,
    MISLEADING_INFO_COST: 5,
    LOCATION_QUESTION_COST: 20,
    BOLD_HINT_COST: 65,
    BROKER_MINUTE_4_MS: 210000,
    BROKER_MINUTE_8_MS: 450000,
    BROKER_RED_BROADCAST_MS: 15000,
    BROKER_OFFER_WINDOW_MS: 35000,
    BROKER_CASH_REWARD: 60,
    AI_REPORT_INTERVAL_MS: 85000,      // تقرير المحلل كل 85 ثانية
    MEETING_DURATION_MS: 120000,
    INITIAL_POINTS: 100,
  };

  K.BOT_NAMES = [
    "أبو حميد", "شيكا", "زيكو", "سيف", "كريم", "ميدو", "نور", "طارق", "حودة", "مريم"
  ];

  K.BOT_SLANG_LINES = [
    "والله العظيم ما أنا يا جدعان كنت رايح أخلص مهمتي!",
    "يا عم أنا لمحت واحد طار جري في الشمال من شوية!",
    "اللي ساكت ومش بيتكلم ده هو الغدّار على ضمانتي 👀",
    "اقروا تقرير المحلل تاني يا رجالة قبل ما نطرد حد بريء!",
    "استنوا نعمل تخطي المرة دي عشان مفيش دليل أكيد.",
    "أنا كنت في القطاع الشرقي ومكنش في حد جنبي خالص!",
    "يا جدعان في حد كان مكمبر عند الناصية.. اعترف مين؟ 😂",
    "لو طردتوني هتندموا والغدّار هيكسب الجيم!",
  ];

  K.QUICK_CHAT_LINES = [
    "والله ما أنا! 😂",
    "كنت بعمل مهمة 🎯",
    "شاكك في الساكت 👀",
    "مين كان في الشمال؟",
    "تخطي يا جدعان ⏭️",
    "اقفشوه هو الغدّار! 🔪"
  ];

  K.SECTORS = [
    "القطاع الشمالي",
    "القطاع الجنوبي",
    "القطاع الشرقي",
    "القطاع الغربي",
    "القطاع المركزي"
  ];

  // Web Audio Synthesizer + Haptics (zero external MP3 dependencies)
  K.SFX = {
    ctx: null,
    muted: localStorage.getItem("kameen_muted") === "1",
    toggle() {
      this.muted = !this.muted;
      try { localStorage.setItem("kameen_muted", this.muted ? "1" : "0"); } catch {}
      if (!this.muted) this.play("click");
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
        const tone = (freq, dur, delay = 0, wave = "sine", vol = 0.12) => {
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

        if (type === "intel") {
          tone(660, 0.11, 0);
          tone(920, 0.18, 0.12);
        } else if (type === "alarm") {
          tone(460, 0.22, 0, "sawtooth", 0.14);
          tone(330, 0.28, 0.24, "sawtooth", 0.14);
          if (navigator.vibrate) navigator.vibrate([180, 80, 220]);
        } else if (type === "kill") {
          tone(175, 0.34, 0, "square", 0.15);
          if (navigator.vibrate) navigator.vibrate([260, 100, 260]);
        } else if (type === "broker") {
          tone(520, 0.09, 0, "triangle");
          tone(780, 0.11, 0.1, "triangle");
          tone(1040, 0.2, 0.22, "triangle");
          if (navigator.vibrate) navigator.vibrate([90, 60, 110]);
        } else if (type === "airdrop") {
          tone(587, 0.1, 0, "triangle");
          tone(880, 0.18, 0.11, "triangle");
          if (navigator.vibrate) navigator.vibrate([80, 50, 80]);
        } else if (type === "win") {
          tone(523, 0.13, 0);
          tone(659, 0.13, 0.14);
          tone(784, 0.24, 0.28);
        } else if (type === "click") {
          tone(540, 0.045, 0, "sine", 0.06);
        }
      } catch {}
    }
  };

  // Shared Helpers
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

  K.showToast = function (msg, ms = 3600) {
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
