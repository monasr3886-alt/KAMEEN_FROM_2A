"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  let cachedLiveModels = null;
  let cachedModelsAtMs = 0;
  let cachedWorkingVisionModel = null;

  function sanitizeKey(raw) {
    return String(raw || "").replace(/[^\x21-\x7E]/g, "").trim();
  }

  let serverEnvAvailable = null;

  function getCustomGroqKey() {
    const userKey = sanitizeKey(K.state && K.state.groqKey);
    if (userKey && userKey.startsWith("gsk_") && userKey.length >= 20) return userKey;
    const defKey = sanitizeKey(K.CONFIG && K.CONFIG.DEFAULT_GROQ_KEY);
    if (defKey && defKey.startsWith("gsk_") && defKey.length >= 20) return defKey;
    return "";
  }

  function hasAnyAiAccess() {
    return Boolean(getCustomGroqKey() || serverEnvAvailable !== false);
  }

  function getProxyUrl() {
    return (K.CONFIG && K.CONFIG.GROQ_PROXY_ENDPOINT) || "/api/groq";
  }

  async function proxyRequest(payload, timeoutMs = 15000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(getProxyUrl(), {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      clearTimeout(timer);
      if (res.status === 503) {
        serverEnvAvailable = false;
        return { ok: false, status: 503, error: "متغير البيئة غير مضبوط على السيرفر" };
      }
      if (res.status === 404) {
        serverEnvAvailable = false;
        return { ok: false, status: 404, error: "مسار الخلفية غير متاح" };
      }
      if (!res.ok) {
        const msg = await readErrorBody(res);
        return { ok: false, status: res.status, error: msg };
      }
      serverEnvAvailable = true;
      const data = await res.json();
      return { ok: true, status: 200, data };
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err && err.name === "AbortError";
      return {
        ok: false,
        status: isTimeout ? "TIMEOUT" : "NETWORK",
        error: isTimeout ? "انتهى وقت الاتصال" : String(err?.message || "Failed to fetch"),
      };
    }
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

  async function fetchLiveGroqModels(force = false) {
    const customKey = getCustomGroqKey();
    if (!force && cachedLiveModels && Date.now() - cachedModelsAtMs < 300000) {
      return { ok: true, status: 200, error: "", models: cachedLiveModels };
    }

    if (customKey) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 12000);
        const res = await fetch("https://api.groq.com/openai/v1/models", {
          method: "GET",
          signal: ctrl.signal,
          headers: { "Authorization": "Bearer " + customKey },
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

    const prox = await proxyRequest({ action: "models" }, 12000);
    if (!prox.ok || !prox.data) {
      return { ok: false, status: prox.status || 0, error: prox.error || "تعذر الاتصال بالخلفية", models: [] };
    }
    const ids = (prox.data.data || [])
      .filter((m) => m && m.id && m.active !== false)
      .map((m) => String(m.id));
    cachedLiveModels = ids;
    cachedModelsAtMs = Date.now();
    return { ok: true, status: 200, error: "", models: ids };
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

  async function testConnection() {
    const res = await fetchLiveGroqModels(true);
    if (!res.ok) {
      return { ok: false, message: formatFriendlyError(res.status, res.error) };
    }
    const modeLbl = getCustomGroqKey() ? "مفتاح AI مخصص" : "متغير Vercel في الخلفية";
    const visionList = pickVisionModelsFromLive(res.models);
    const vTxt = visionList.length ? visionList[0] : "تلقائي";
    return {
      ok: true,
      message: `متصل (${modeLbl}) • ${res.models.length} موديل • Vision: ${vTxt}`,
    };
  }

  async function callGroqChat(systemPrompt, userPrompt, maxTokens = 130) {
    const customKey = getCustomGroqKey();
    if (!customKey && serverEnvAvailable === false) return null;
    if (!cachedLiveModels) {
      await fetchLiveGroqModels(false);
    }
    const models = pickChatModelsFromLive(cachedLiveModels || []);
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    for (const model of models) {
      try {
        if (customKey) {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 12000);
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            signal: ctrl.signal,
            headers: {
              "Authorization": "Bearer " + customKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ model, messages, temperature: 0.85, max_tokens: maxTokens }),
          });
          clearTimeout(timer);
          if (res.ok) {
            const j = await res.json();
            const txt = j.choices?.[0]?.message?.content?.trim();
            if (txt) return txt.replace(/^["«]|["»]$/g, "");
          }
          if (res.status === 401) break;
        } else {
          const prox = await proxyRequest({ action: "chat", model, messages, temperature: 0.85, max_tokens: maxTokens }, 12000);
          if (prox.ok && prox.data) {
            const txt = prox.data.choices?.[0]?.message?.content?.trim();
            if (txt) return txt.replace(/^["«]|["»]$/g, "");
          }
          if (prox.status === 503 || prox.status === 404) break;
        }
      } catch {}
    }
    return null;
  }

  async function postVisionAttempt(customKey, model, framesSubset, promptText) {
    const contentParts = [{ type: "text", text: promptText }];
    for (const b64 of framesSubset) {
      contentParts.push({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64," + b64 },
      });
    }
    const messages = [{ role: "user", content: contentParts }];

    if (customKey) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          signal: ctrl.signal,
          headers: {
            "Authorization": "Bearer " + customKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 180 }),
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

    const prox = await proxyRequest({ action: "chat", model, messages, temperature: 0.2, max_tokens: 180 }, 25000);
    if (!prox.ok || !prox.data) {
      return { ok: false, status: prox.status || "NETWORK", error: prox.error || "proxy_error", raw: "" };
    }
    return { ok: true, status: 200, error: "", raw: prox.data.choices?.[0]?.message?.content || "" };
  }

  async function verifyMissionWithGroqVision(framesB64, mission) {
    const customKey = getCustomGroqKey();
    if (!customKey && serverEnvAvailable === false) {
      return {
        ok: false,
        noKey: true,
        seen: "",
        reason: "تقدر تضيف مفتاح AI خاص في الإعدادات (≡) أو تضبط متغير البيئة على Vercel.",
      };
    }

    const live = await fetchLiveGroqModels(false);
    if (!live.ok) {
      return { ok: false, seen: "", reason: formatFriendlyError(live.status, live.error) };
    }

    const visionModels = pickVisionModelsFromLive(live.models);
    if (!visionModels.length) {
      return {
        ok: false,
        seen: "",
        reason: `لا توجد موديلات صور متاحة حالياً (${live.models.slice(0, 5).join(", ")}).`,
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
      let attempt = await postVisionAttempt(customKey, model, multiFrames, promptText);
      if (!attempt.ok && multiFrames.length > 1 && (attempt.status === 400 || attempt.status === 413)) {
        attempt = await postVisionAttempt(customKey, model, middleFrame, promptText);
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
      if (!bestErrStatus || (bestErrStatus === 404 && attempt.status !== 404)) {
        bestErrStatus = attempt.status;
        bestErrDetail = `[${model}] ${attempt.error}`;
      }
    }

    cachedModelsAtMs = 0;
    return {
      ok: false,
      seen: "",
      reason: formatFriendlyError(bestErrStatus, bestErrDetail || triedErrors.join(" | ")),
    };
  }

  async function verifyMissionSpeechWithGroqWhisper(file, mission) {
    const customKey = getCustomGroqKey();
    if (!customKey || !mission || !Array.isArray(mission.requiresSpeech) || !mission.requiresSpeech.length) {
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
          headers: { "Authorization": "Bearer " + customKey },
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
      const signals = [];
      if (summary.freshKillPlace) signals.push({ angle: "kill", fact: `في جريمة إقصاء حصلت من شوية ${summary.freshKillPlace} (عدد الجثث غير المبلغ عنها: ${summary.unreportedBodies})` });
      if (summary.stalkingPlace) signals.push({ angle: "stalk", fact: `في لاعب بيتتبع لاعب تاني من مسافة قريبة ${summary.stalkingPlace} كأنه بيستنى اللحظة المناسبة` });
      if (summary.sprinterPlace) signals.push({ angle: "sprint", fact: `في لاعب جري فجأة بسرعة عالية ${summary.sprinterPlace}` });
      if (summary.zeroMissionWandererPlace) signals.push({ angle: "wander", fact: `في لاعب لسه مخلصش ولا مهمة وعمال يلف بشكل مريب ${summary.zeroMissionWandererPlace}` });
      if (summary.camperPlace) signals.push({ angle: "camp", fact: `في لاعب واقف مكمبر ثابت مكانه بقاله ${summary.camperSec} ثانية ${summary.camperPlace}` });
      if (summary.encounterPlace) signals.push({ angle: "enc", fact: `اتنين لاعبين قربوا من بعض جداً ${summary.encounterPlace}` });
      if (summary.recentMissionPlace) signals.push({ angle: "mission", fact: `تم إنجاز مهمة ميدانية من شوية ${summary.recentMissionPlace} (تقدم القضية ${summary.investigationProgress})` });
      if (summary.zoneEdgePlace) signals.push({ angle: "edge", fact: `في لاعب بيتحرك لازق في حافة الزون ${summary.zoneEdgePlace}` });
      if (summary.isolatedPlace) signals.push({ angle: "iso", fact: `في لاعب معزول لوحده بعيد عن الباقي ${summary.isolatedPlace}` });

      // Pick the sharpest signal that is DIFFERENT from lastPublicAngle so reports never feel repetitive!
      let picked = signals.find((s) => s.angle !== summary.lastPublicAngle) || signals[0] || null;
      if (picked && st.engine.state) st.engine.state.lastPublicAngle = picked.angle;

      const sysPrompt =
        "أنت 'المحلل العام' (محقق سلوك ذكي) في لعبة مطاردة GPS في الشارع اسمها 'كمين'. " +
        "مهمتك تدي تلميح استنتاجي حقيقي ومفيد للكل باللهجة المصرية الحماسية في جملتين قصيرين بالظبط. " +
        "قواعد صارمة: 1) ابني تحليلك على الحدث الرئيسي الموجود في البيانات واذكر اسم الشارع أو المعلم الحقيقي زي ما هو. " +
        "2) ممنوع تماماً تذكر أسماء لاعبين، وممنوع تقول قطاع شمالي أو جنوبي، وممنوع تكتب كلام عام فاضي مفيهوش معلومة مكانية.";

      const userPrompt =
        `الحدث السلوكي الأهم الآن: ${picked ? picked.fact : "توزيع اللاعبين في المنطقة: " + JSON.stringify(summary.placeCounts)}\n` +
        `تفاصيل مساعدة: أحياء=${summary.livingCount}، جثث=${summary.bodiesCount}، تقدم القضية=${summary.investigationProgress}، ` +
        `نصف قطر الزون=${summary.zoneRadiusMeters}م، خاتمة سخنة=${summary.showdownActive ? "نعم" : "لأ"}.`;

      let text = await callGroqChat(sysPrompt, userPrompt, 145);
      const source = text ? "groq" : "local";

      if (!text) {
        const busy = Object.entries(summary.placeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "نص المنطقة";
        const a = picked ? picked.angle : "crowd";
        if (a === "kill") text = `إنذار ميداني: في ضحية وقعت من لحظات ${summary.freshKillPlace} — اللي شوفتوه طالع من هناك بسرعة عليه مليون علامة استفهام!`;
        else if (a === "stalk") text = `رادار السلوك لقط مطاردة صامتة ${summary.stalkingPlace}.. في واحد ماشي ورا التاني عن قرب، لو إنت هناك التفت وراك فوراً!`;
        else if (a === "sprint") text = `في لاعب طار جري فجأة ${summary.sprinterPlace}.. يا إما عمل عملة وبيهرب يا إما لمح الغدّار وهرب منه!`;
        else if (a === "wander") text = `ملاحظة مريبة: في لاعب عمال يلف ${summary.zeroMissionWandererPlace} ومخلصش ولا مهمة لحد دلوقتي.. يا ترى بيتموّه ولا بيدوّر على صيدة؟`;
        else if (a === "camp") text = `في حد مكمبر مكانه بقاله ${summary.camperSec} ثانية ${summary.camperPlace}.. لو مفيش مهمة هناك يبقى عامل كمين!`;
        else if (a === "enc") text = `اتنين اتقابلوا على مسافة قريبة أوي ${summary.encounterPlace}.. لو حد فيهم اختفى بعد شوية هتعرفوا مين اللي كان معاه!`;
        else if (a === "mission") text = `تقدم للمحققين (${summary.investigationProgress}) بعد تنفيذ مهمة ${summary.recentMissionPlace}.. الغدّار أكيد هيحاول يوقفكم هناك!`;
        else if (a === "edge") text = `في لاعب بيتحرك لازق على حافة الزون ${summary.zoneEdgePlace} كأنه بيستخبى من الزحمة!`;
        else if (a === "iso") text = `في لاعب ماشي معزول لوحده تماماً ${summary.isolatedPlace} — يا إما بيجهز كمين يا إما صيدة سهلة!`;
        else text = `التجمع الأكبر حالياً ${busy} وسط ${summary.livingCount} أحياء ونصف قطر ${summary.zoneRadiusMeters}م.. ركّز مين بيتجنب الزحمة!`;
      }

      st.engine.addAIReport(text, source, st.simTimeMs);
      st.lastIntel = `المحلل العام: ${text}`;
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
    getCustomGroqKey,
    hasAnyAiAccess,
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
