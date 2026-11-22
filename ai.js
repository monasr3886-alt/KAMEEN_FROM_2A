"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  let cachedLiveModels = null;
  let cachedModelsAtMs = 0;
  let cachedWorkingVisionModel = null;

  function sanitizeKey(raw) {
    return String(raw || "").replace(/[^\x21-\x7E]/g, "").trim();
  }

  function getGroqKey() {
    const userKey = sanitizeKey(K.state && K.state.groqKey);
    if (userKey && userKey.startsWith("gsk_") && userKey.length >= 20) return userKey;
    const defKey = sanitizeKey(K.CONFIG && K.CONFIG.DEFAULT_GROQ_KEY);
    if (defKey && defKey.startsWith("gsk_") && defKey.length >= 20) return defKey;
    return userKey || defKey || "";
  }

  function normalizeArabic(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ة/g, "ه")
      .replace(/ى/g, "ي")
      .replace(/[^\u0621-\u064Aa-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function extractJsonObject(rawText) {
    const txt = String(rawText || "").trim();
    if (!txt) return null;
    try { return JSON.parse(txt); } catch {}
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }

  async function readErrorBody(res) {
    try {
      const txt = await res.text();
      try {
        const j = JSON.parse(txt);
        return String(j?.error?.message || j?.message || txt).slice(0, 180);
      } catch {
        return txt.slice(0, 180);
      }
    } catch {
      return "";
    }
  }

  // Always fetch live active models from Groq FIRST so we NEVER call a deprecated/404 model ID!
  async function fetchLiveGroqModels(force = false) {
    const key = getGroqKey();
    if (!key) return { ok: false, status: 0, error: "مفيش مفتاح Groq", models: [] };
    if (!force && cachedLiveModels && Date.now() - cachedModelsAtMs < 300000) {
      return { ok: true, status: 200, error: "", models: cachedLiveModels };
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch("https://api.groq.com/openai/v1/models", {
        method: "GET",
        signal: ctrl.signal,
        headers: { "Authorization": "Bearer " + key },
      });
      clearTimeout(timer);
      if (!res.ok) {
        const msg = await readErrorBody(res);
        return { ok: false, status: res.status, error: msg, models: [] };
      }
      const j = await res.json();
      const ids = (j.data || [])
        .filter((m) => m && m.id && m.active !== false)
        .map((m) => String(m.id));
      cachedLiveModels = ids;
      cachedModelsAtMs = Date.now();
      return { ok: true, status: 200, error: "", models: ids };
    } catch (err) {
      const isTimeout = err && err.name === "AbortError";
      return {
        ok: false,
        status: isTimeout ? "TIMEOUT" : "NETWORK",
        error: isTimeout ? "انتهى وقت الاتصال" : String(err?.message || "Failed to fetch"),
        models: [],
      };
    }
  }

  function isNonChatModel(id) {
    return /whisper|tts|orpheus|playai|guard|embed|rerank|safeguard|prompt-guard|distil-whisper|allam/i.test(id);
  }

  function pickVisionModelsFromLive(liveIds) {
    const live = Array.isArray(liveIds) ? liveIds : [];
    const out = [];
    const addIfLive = (id) => {
      if (id && live.includes(id) && !out.includes(id) && !isNonChatModel(id)) out.push(id);
    };

    // 1. Previously verified working vision model comes first!
    if (cachedWorkingVisionModel) addIfLive(cachedWorkingVisionModel);

    // 2. High-confidence multimodal / vision model patterns (ONLY if actually live on Groq!)
    const visionPatterns = [
      /llama-?4.*scout/i,
      /llama-?4.*maverick/i,
      /llama-?4/i,
      /vision/i,
      /qwen.*vl/i,
      /pixtral/i,
      /llava/i,
      /gemma-?3|gemma-?4/i,
      /kimi.*vl|kimi-k2\.5|kimi-k2/i,
      /multimodal|omni|vl-/i,
    ];
    for (const pat of visionPatterns) {
      for (const id of live) {
        if (pat.test(id)) addIfLive(id);
      }
    }

    // 3. Fallback probe candidates (in case Groq launched a vision-capable model with a new name)
    if (out.length === 0) {
      for (const id of live) {
        if (!isNonChatModel(id) && !/compound/i.test(id)) {
          addIfLive(id);
          if (out.length >= 4) break;
        }
      }
    }
    return out;
  }

  function pickChatModelsFromLive(liveIds) {
    const live = Array.isArray(liveIds) ? liveIds : [];
    const preferred = [
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "meta-llama/llama-4-scout-17b-16e-instruct",
    ];
    const out = [];
    for (const p of preferred) {
      if (live.includes(p) && !out.includes(p)) out.push(p);
    }
    for (const id of live) {
      if (!isNonChatModel(id) && !out.includes(id)) {
        out.push(id);
        if (out.length >= 4) break;
      }
    }
    return out.length ? out : ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  }

  function formatFriendlyError(status, detail) {
    const d = String(detail || "");
    if (status === 401 || /invalid.*api.*key|expired|revoked/i.test(d)) {
      return "مفتاح Groq مرفوض أو ملغي (401) — اعمل مفتاح جديد من console.groq.com والصقه في الإعدادات (≡).";
    }
    if (status === 403) {
      return `سيرفر Groq رفض الاتصال (403) — اتأكد إن المفتاح شغال وإن مفيش VPN أو حجب. ${d ? "(" + d.slice(0, 70) + ")" : ""}`;
    }
    if (status === 429) {
      return "ضغط لحظي على سيرفر Groq (429) — استنى 5 ثواني وحاول تاني.";
    }
    if (status === "TIMEOUT") {
      return "انتهى وقت الاتصال (Timeout) — النت بطيء شوية، حاول تاني.";
    }
    if (status === "NETWORK") {
      return "المتصفح مش قادر يوصل لـ api.groq.com — اتأكد من النت أو جرّب تقفل AdBlocker/DNS الخاص.";
    }
    return `خطأ من سيرفر Groq (${status || "?"}): ${d || "حاول تاني بعد لحظات."}`;
  }

  // Live 1-tap diagnostics for Settings Drawer
  async function testConnection() {
    const key = getGroqKey();
    if (!key) {
      return { ok: false, message: "لا يوجد مفتاح Groq AI محفوظ." };
    }
    const res = await fetchLiveGroqModels(true);
    if (!res.ok) {
      return { ok: false, message: formatFriendlyError(res.status, res.error) };
    }
    const visionList = pickVisionModelsFromLive(res.models);
    const whisperList = res.models.filter((id) => /whisper/i.test(id));
    const vTxt = visionList.length ? visionList[0] : "لا يوجد موديل صور واضح";
    const wTxt = whisperList.length ? whisperList[0] : "غير متاح";
    return {
      ok: true,
      message: `متصل بـ Groq (${res.models.length} موديل) • Vision: ${vTxt} • صوت: ${wTxt} • المتاح: ${visionList.slice(0, 3).join(", ") || res.models.slice(0, 4).join(", ")}`,
    };
  }

  async function callGroqChat(systemPrompt, userPrompt, maxTokens = 130) {
    const key = getGroqKey();
    if (!key) return null;
    if (!cachedLiveModels) {
      await fetchLiveGroqModels(false);
    }
    const models = pickChatModelsFromLive(cachedLiveModels || []);
    for (const model of models) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Authorization": "Bearer " + key,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.85,
            max_tokens: maxTokens,
          }),
        });
        clearTimeout(timer);
        if (res.ok) {
          const j = await res.json();
          const txt = j.choices?.[0]?.message?.content?.trim();
          if (txt) return txt.replace(/^["«]|["»]$/g, "");
        }
        if (res.status === 401) break;
      } catch {}
    }
    return null;
  }

  async function postVisionAttempt(key, model, framesSubset, promptText) {
    const contentParts = [{ type: "text", text: promptText }];
    for (const b64 of framesSubset) {
      contentParts.push({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64," + b64 },
      });
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: contentParts }],
          temperature: 0.2,
          max_tokens: 180,
        }),
      });
      clearTimeout(timer);
      if (!res.ok) {
        const errMsg = await readErrorBody(res);
        return { ok: false, status: res.status, error: errMsg, raw: "" };
      }
      const j = await res.json();
      return { ok: true, status: 200, error: "", raw: j.choices?.[0]?.message?.content || "" };
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err && err.name === "AbortError";
      return {
        ok: false,
        status: isTimeout ? "TIMEOUT" : "NETWORK",
        error: isTimeout ? "timeout" : String(err?.message || "network_error"),
        raw: "",
      };
    }
  }

  // Strict Mission-Specific Vision Verification: ALWAYS queries live models first — ZERO 404 on dead models!
  async function verifyMissionWithGroqVision(framesB64, mission) {
    const key = getGroqKey();
    if (!key) {
      return {
        ok: false,
        noKey: true,
        seen: "",
        reason: "لازم تضيف مفتاح Groq AI في الإعدادات (≡) عشان الذكاء الاصطناعي يفحص المهمة!",
      };
    }

    // 1. Discover LIVE models on this Groq key BEFORE calling chat/completions
    const live = await fetchLiveGroqModels(false);
    if (!live.ok) {
      return { ok: false, seen: "", reason: formatFriendlyError(live.status, live.error) };
    }

    const visionModels = pickVisionModelsFromLive(live.models);
    if (!visionModels.length) {
      return {
        ok: false,
        seen: "",
        reason: `حساب Groq ده مفيش عليه موديلات صور متاحة حالياً (${live.models.slice(0, 5).join(", ")}).`,
      };
    }

    const rule = (mission && mission.aiVisionRule)
      ? mission.aiVisionRule
      : "A real outdoor street scene matching the mission description.";
    const mTitle = mission ? mission.title : "مهمة ميدانية";

    const promptText =
      `You are a strict, fair referee for an Egyptian real-world outdoor GPS street game called "Kameen".\n` +
      `Mission Title: "${mTitle}"\n` +
      `Required Visual Proof: ${rule}\n\n` +
      `Inspect the attached camera image(s) carefully. Rules:\n` +
      `1. Reject if the required object/animal/gesture is NOT clearly visible, or if it's a photo of another phone/laptop screen, a blank wall, a dark/covered camera, or unrelated scene.\n` +
      `2. Accept if the required subject is genuinely visible in at least one frame.\n` +
      `3. Reply ONLY with valid JSON (no markdown, no extra text):\n` +
      `{"passed": true or false, "seen": "وصف قصير بالعامية المصرية للي شفته في الكاميرا فعلياً", "reason": "تعليق روش قصير بالعامية المصرية يوضح ليه قبلت أو رفضت"}`;

    const middleFrame = [framesB64[Math.floor(framesB64.length / 2)] || framesB64[0]];
    const multiFrames = framesB64.slice(0, 3);

    let bestErrStatus = null;
    let bestErrDetail = "";
    const triedErrors = [];

    for (const model of visionModels) {
      let attempt = await postVisionAttempt(key, model, multiFrames, promptText);

      // If multi-frame payload rejected (400 / 413), retry same model with 1 sharp frame (some models allow max 1 image!)
      if (!attempt.ok && multiFrames.length > 1 && (attempt.status === 400 || attempt.status === 413)) {
        attempt = await postVisionAttempt(key, model, middleFrame, promptText);
      }

      if (attempt.ok) {
        cachedWorkingVisionModel = model;
        const raw = attempt.raw;
        const parsed = extractJsonObject(raw);
        if (parsed && typeof parsed.passed === "boolean") {
          return {
            ok: parsed.passed,
            seen: String(parsed.seen || "").trim(),
            reason: String(parsed.reason || (parsed.passed ? "الذكاء الاصطناعي اعتمد اللقطة!" : "اللقطة مش مطابقة للمهمة!")).trim(),
          };
        }
        const upper = raw.toUpperCase();
        if (upper.includes("TRUE") || upper.includes("YES")) {
          return { ok: true, seen: "تم الفحص البصري", reason: "الذكاء الاصطناعي اعتمد اللقطة!" };
        }
        return { ok: false, seen: raw.slice(0, 80), reason: "الذكاء الاصطناعي مش شايف المطلوب في الصورة بوضوح، صوّر تاني!" };
      }

      triedErrors.push(`${model}: ${attempt.status}`);
      if (attempt.status === 401 || attempt.status === 403 || attempt.status === 429) {
        return { ok: false, seen: "", reason: formatFriendlyError(attempt.status, attempt.error) };
      }

      // Preserve the most informative error (don't let a generic 404 overwrite a real 400!)
      if (!bestErrStatus || (bestErrStatus === 404 && attempt.status !== 404)) {
        bestErrStatus = attempt.status;
        bestErrDetail = `[${model}] ${attempt.error}`;
      }
    }

    // Force-refresh model cache on next attempt if all candidates failed
    cachedModelsAtMs = 0;
    return {
      ok: false,
      seen: "",
      reason: formatFriendlyError(bestErrStatus, bestErrDetail || triedErrors.join(" | ")),
    };
  }

  // Real Arabic Speech Verification via Groq Whisper
  async function verifyMissionSpeechWithGroqWhisper(file, mission) {
    const key = getGroqKey();
    if (!key || !mission || !Array.isArray(mission.requiresSpeech) || !mission.requiresSpeech.length) {
      return { checked: false, ok: true, transcript: "" };
    }
    if (!file || file.size > 20 * 1024 * 1024) {
      return { checked: false, ok: true, transcript: "" };
    }

    let whisperModels = ["whisper-large-v3-turbo", "whisper-large-v3"];
    if (cachedLiveModels && cachedLiveModels.length) {
      const liveW = cachedLiveModels.filter((id) => /whisper/i.test(id));
      if (liveW.length) whisperModels = liveW;
    }

    for (const model of whisperModels) {
      try {
        const mime = String(file.type || "").toLowerCase();
        let ext = "webm";
        if (mime.includes("mp4") || mime.includes("m4a")) ext = "mp4";
        else if (mime.includes("wav")) ext = "wav";
        else if (mime.includes("ogg")) ext = "ogg";
        else if (mime.includes("mpeg") || mime.includes("mp3")) ext = "mp3";
        const fname = (file.name && /\.[a-z0-9]{2,5}$/i.test(file.name)) ? file.name : ("mission." + ext);
        const fd = new FormData();
        fd.append("file", file, fname);
        fd.append("model", model);
        fd.append("language", "ar");
        fd.append("prompt", mission.requiresSpeech.join(" "));

        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 18000);
        const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Authorization": "Bearer " + key },
          body: fd,
        });
        clearTimeout(timer);

        if (!res.ok) continue;
        const j = await res.json();
        const transcript = String(j.text || "").trim();
        const normText = normalizeArabic(transcript);
        const targets = mission.requiresSpeech.map(normalizeArabic).filter(Boolean);
        const matched = targets.some((w) => normText.includes(w));
        return { checked: true, ok: matched, transcript };
      } catch {}
    }
    return { checked: false, ok: true, transcript: "" };
  }

  async function extractFramesFromFile(file) {
    const frames = [];
    let maxAvgLum = 0;

    if (file.type && file.type.startsWith("image/")) {
      const imgUrl = URL.createObjectURL(file);
      const img = new Image();
      img.src = imgUrl;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        setTimeout(() => rej(new Error("timeout")), 8000);
      });
      const c = document.createElement("canvas");
      const maxW = 448;
      const ratio = Math.min(1, maxW / Math.max(1, img.naturalWidth || 448));
      c.width = Math.max(220, Math.round((img.naturalWidth || 448) * ratio));
      c.height = Math.max(165, Math.round((img.naturalHeight || 336) * ratio));
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(imgUrl);

      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let lum = 0;
      for (let i = 0; i < data.length; i += 24) lum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      maxAvgLum = lum / Math.max(1, data.length / 24);
      frames.push(c.toDataURL("image/jpeg", 0.72).split(",")[1]);
      return { frames, maxAvgLum, isVideo: false };
    }

    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    await new Promise((res, rej) => {
      video.onloadedmetadata = res;
      video.onerror = rej;
      setTimeout(() => rej(new Error("timeout")), 9000);
    });

    const dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 3;
    if (dur > 25) {
      URL.revokeObjectURL(url);
      throw new Error("TOO_LONG");
    }

    const seekPoints = dur >= 2.2 ? [dur * 0.2, dur * 0.5, dur * 0.8] : [Math.min(0.4, dur * 0.5)];
    const c = document.createElement("canvas");
    c.width = 360;
    c.height = 270;
    const ctx = c.getContext("2d");

    for (const t of seekPoints) {
      video.currentTime = Math.max(0.05, Math.min(dur - 0.05, t));
      await new Promise((r) => {
        const done = () => { video.onseeked = null; r(); };
        video.onseeked = done;
        setTimeout(done, 1100);
      });
      ctx.drawImage(video, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let lum = 0;
      for (let i = 0; i < data.length; i += 24) lum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      const avg = lum / Math.max(1, data.length / 24);
      if (avg > maxAvgLum) maxAvgLum = avg;
      frames.push(c.toDataURL("image/jpeg", 0.66).split(",")[1]);
    }

    URL.revokeObjectURL(url);
    return { frames, maxAvgLum, isVideo: true };
  }

  async function triggerProfilerReport(forceNow = false) {
    const st = K.state;
    if (!st.engine || !K.App.isMatchHost() || st.aiBusy) return;
    const snap = st.engine.getSnapshot();
    if (snap.phase !== "ACTIVE") return;
    if (!forceNow && !st.engine.consumeAiReportSlot()) return;

    st.aiBusy = true;
    try {
      const summary = st.engine.buildAnonymizedSummaryForAI();
      const sysPrompt =
        "أنت 'المحلل النفسي' في لعبة مطاردة وتجسس بالـ GPS في الشارع اسمها 'كمين'. " +
        "اتكلم باللهجة المصرية الشعبية الروشة والمشوّقة (زي: يا رجالة، صحصحوا، مكمبر، طار جري، افتحوا عينيكم). " +
        "استخدم أسماء الأماكن الحقيقية من الخريطة زي ما هي في البيانات (مثال: قريب من مسجد كذا أو عند شارع كذا)، وممنوع تماماً تقول قطاع شمالي أو جنوبي أو شرقي أو غربي، وممنوع تذكر أسماء لاعبين. اكتب جملتين قصار ومباشرين.";

      const userPrompt =
        `بيانات الميدان الحقيقية من الخريطة: عدد الأحياء ${summary.livingCount}، ` +
        `تواجد اللاعبين عند الأماكن ${JSON.stringify(summary.placeCounts)}، ` +
        `عدد الجثث ${summary.bodiesCount}، ` +
        `نص قطر الزون ${summary.zoneRadiusMeters}م، ` +
        `وضع الخاتمة السخنة: ${summary.showdownActive ? "شغال" : "لسه"}، ` +
        `هل فيه لاعب جري بسرعة فجأة؟ ${summary.sprinterPlace || "لأ"}، ` +
        `هل فيه لاعب مكمبر مكانه كتير؟ ${summary.camperPlace || "لأ"}، ` +
        `هل اتنين قربوا من بعض جداً؟ ${summary.encounterPlace || "لأ"}.`;

      let text = await callGroqChat(sysPrompt, userPrompt, 135);
      const source = text ? "groq" : "local";

      if (!text) {
        const busy = Object.entries(summary.placeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "نص المنطقة";
        if (summary.sprinterPlace) {
          text = `يا رجالة صحصحوا! في واحد طار جري فجأة ${summary.sprinterPlace}.. يا إما عمل عملة وبيهرب يا إما مرعوب!`;
        } else if (summary.camperPlace) {
          text = `رادار السلوك لقط حد مكمبر مكانه بقاله حبة ${summary.camperPlace}.. يا ترى مستخبي ولا عامل كمين؟`;
        } else if (summary.encounterPlace) {
          text = `اتنين قربوا من بعض أوي ${summary.encounterPlace}.. هل ده تحالف ولا كانت خناقة على نضافة؟`;
        } else {
          text = summary.bodiesCount > 0
            ? `الجو ولّع ${busy}! فيه ${summary.bodiesCount} ضحية لحد دلوقتي والزون بقت ${summary.zoneRadiusMeters}م!`
            : `الزحمة كلها متجمعة ${busy} بين ${summary.livingCount} لاعبين أحياء.. متأمنش للي ماشي وراك!`;
        }
      }

      st.engine.addAIReport(text, source, st.simTimeMs);
      st.lastIntel = `المحلل (${source === "groq" ? "AI" : "رادار"}): ${text}`;
      K.SFX.play("intel");
      K.Network.broadcastMatchSnapshot(true);
      if (st.route === "game" || st.route === "simulation") K.UI.updateHudOnly();
    } finally {
      st.aiBusy = false;
    }
  }

  async function generateMatchRecap(snap) {
    if (!K.state.engine || !K.App.isMatchHost() || snap.aiMatchRecap) return;
    const imposters = Object.values(snap.players).filter((p) => p.role === "IMPOSTER").map((p) => p.name);
    const awards = K.state.engine.computeAwards();
    const sys = "أنت المعلق الشعبي الروش في نهاية جيم لعبة 'كمين'. اكتب تعليق ختامي مضحك وحماسي في جملتين بالعامية المصرية تبارك فيه للفائزين وتهزر مع الشلة.";
    const usr = `الفائز: ${snap.winner === "INVESTIGATORS" ? "المفتشين" : "الغدّارين"}، السبب: ${snap.winReason}، الغدّارين كانوا: ${imposters.join(" و ")}، الألقاب: ${awards.map((a) => a.title + " " + a.player).join("، ")}.`;
    const recap = await callGroqChat(sys, usr, 140);
    if (recap && K.state.engine) {
      K.state.engine.setAIMatchRecap(recap);
      K.Network.broadcastMatchSnapshot(true);
      if (K.state.route === "result") {
        const box = document.getElementById("ai-recap-box");
        if (box) {
          box.textContent = "تعليق المحلل: " + recap;
          box.classList.remove("hidden");
        }
      }
    }
  }

  async function analyzeCapturedSubmission(missionId, payload) {
    const st = K.state;
    if (!st.engine || !payload || !Array.isArray(payload.frames) || !payload.frames.length) return;

    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const mission = (vis.missions || []).find((m) => m.id === missionId);
    if (!mission) return;

    if (!getGroqKey()) {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = "مفيش مفتاح Groq AI! افتح الإعدادات (≡) والصق مفتاحك عشان الذكاء الاصطناعي يحلل المهمة.";
      K.UI.updateCameraModalStatus();
      return;
    }

    if (typeof payload.maxAvgLum === "number" && payload.maxAvgLum < 9) {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = "الكاميرا ضلمة كحل! شيل إيدك من على العدسة وصوّر المهمة بوضوح.";
      K.UI.updateCameraModalStatus();
      return;
    }

    st.videoAnalyzing = true;
    st.videoVerdictTone = "pending";
    st.videoVerdict = payload.isVideo
      ? `جاري فحص ${payload.frames.length} لقطات من الفيديو بـ Groq Vision...`
      : "جاري تحليل الصورة بـ Groq Vision...";
    K.UI.updateCameraModalStatus();

    try {
      const vision = await verifyMissionWithGroqVision(payload.frames, mission);
      if (!vision.ok) {
        st.videoAnalyzing = false;
        st.videoVerdictTone = "error";
        st.videoVerdict = (vision.seen ? `الذكاء الاصطناعي شاف: «${vision.seen}» — ` : "") + vision.reason;
        K.UI.updateCameraModalStatus();
        return;
      }

      let speechNote = "";
      if (mission.requiresSpeech && mission.requiresSpeech.length) {
        if (!payload.audioBlob) {
          st.videoAnalyzing = false;
          st.videoVerdictTone = "error";
          st.videoVerdict = "المهمة دي محتاجة صوت! اضغط زر التسجيل المباشر واتكلم بوضوح أثناء التصوير.";
          K.UI.updateCameraModalStatus();
          return;
        }
        st.videoVerdict = `البصر تمام (${vision.seen || "مظبوط"}) — جاري فحص صوتك بـ Whisper AI...`;
        K.UI.updateCameraModalStatus();
        const speech = await verifyMissionSpeechWithGroqWhisper(payload.audioBlob, mission);
        if (speech.checked && !speech.ok) {
          st.videoAnalyzing = false;
          st.videoVerdictTone = "error";
          const heard = speech.transcript ? `سمعت: «${speech.transcript}»` : "مسمعتش صوت واضح";
          st.videoVerdict = `الذكاء الاصطناعي شاف المشهد صح، بس ${heard} — علّي صوتك وقول المطلوب بوضوح في التسجيل!`;
          K.UI.updateCameraModalStatus();
          return;
        }
        if (speech.checked && speech.transcript) {
          speechNote = ` • صوتك: «${speech.transcript.slice(0, 40)}»`;
        }
      }

      const summaryVerdict = `${vision.seen ? `AI شاف: ${vision.seen} — ` : ""}${vision.reason}${speechNote}`;
      st.videoAnalyzing = false;
      st.videoVerdictTone = "success";
      st.videoVerdict = "تم الاعتماد بالذكاء الاصطناعي! " + summaryVerdict;
      K.UI.updateCameraModalStatus();
      K.SFX.play("win");

      setTimeout(() => {
        if (K.Camera && typeof K.Camera.stop === "function") K.Camera.stop();
        if (K.state.modal === "camera" && K.state.activeCameraMissionId === missionId) {
          K.state.modal = null;
          K.state.videoVerdict = null;
          K.UI.renderModal();
        }
        K.App.dispatchAction("MISSION_COMPLETE", {
          missionId,
          videoVerified: true,
          aiNote: vision.seen || vision.reason,
        });
      }, 1100);
    } catch {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = "حصل خطأ أثناء التحليل — جرّب تصوّر تاني.";
      K.UI.updateCameraModalStatus();
    }
  }

  async function analyzeMissionMedia(missionId, file) {
    const st = K.state;
    if (!file || !st.engine) return;

    const vis = st.engine.getVisibleStateForPlayer(st.user.id);
    const mission = (vis.missions || []).find((m) => m.id === missionId);
    if (!mission) return;

    const isVideoFile = Boolean(file.type && file.type.startsWith("video/"));
    if (mission.requiresSpeech && mission.requiresSpeech.length && !isVideoFile) {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = "المهمة دي فيها صوت! لازم تصوّر فيديو بالصوت عشان الذكاء الاصطناعي يسمع كلامك.";
      K.UI.updateCameraModalStatus();
      return;
    }

    st.videoAnalyzing = true;
    st.videoVerdictTone = "pending";
    st.videoVerdict = "جاري تجهيز اللقطات للفحص بالذكاء الاصطناعي...";
    K.UI.updateCameraModalStatus();

    try {
      const { frames, maxAvgLum } = await extractFramesFromFile(file);
      await analyzeCapturedSubmission(missionId, {
        frames,
        maxAvgLum,
        audioBlob: isVideoFile ? file : null,
        isVideo: isVideoFile,
      });
    } catch (err) {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = err && err.message === "TOO_LONG"
        ? "الفيديو أطول من 25 ثانية — صوّر فيديو قصير (3 لـ 8 ثواني)!"
        : "معرفتش أقرأ الملف — جرّب التصوير المباشر من جوه الموقع.";
      K.UI.updateCameraModalStatus();
    }
  }

  K.AI = {
    getGroqKey,
    testConnection,
    callGroqChat,
    verifyMissionWithGroqVision,
    verifyMissionSpeechWithGroqWhisper,
    triggerProfilerReport,
    generateMatchRecap,
    analyzeCapturedSubmission,
    analyzeMissionMedia,
  };
})(window.Kameen);
