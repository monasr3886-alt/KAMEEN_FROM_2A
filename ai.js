"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  function getGroqKey() {
    return ((K.state && K.state.groqKey) || K.CONFIG.DEFAULT_GROQ_KEY || "").trim();
  }

  function normalizeArabic(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, "") // strip tashkeel
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

  async function callGroqChat(systemPrompt, userPrompt, maxTokens = 130) {
    const key = getGroqKey();
    if (!key) return null;
    const models = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
    for (const model of models) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 9000);
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
      } catch {}
    }
    return null;
  }

  // Strict Mission-Specific Vision Verification (1 frame for photo, up to 3 keyframes for video)
  async function verifyMissionWithGroqVision(framesB64, mission) {
    const key = getGroqKey();
    if (!key) {
      return {
        ok: false,
        noKey: true,
        seen: "",
        reason: "لازم تضيف مفتاح Groq AI في الإعدادات (≡) عشان الذكاء الاصطناعي يفحص المهمة ويتأكد منها!",
      };
    }

    const rule = (mission && mission.aiVisionRule)
      ? mission.aiVisionRule
      : "A real outdoor street scene matching the mission description.";
    const mTitle = mission ? mission.title : "مهمة ميدانية";

    const contentParts = [
      {
        type: "text",
        text:
          `You are a strict, fair referee for an Egyptian real-world outdoor GPS street game called "Kameen".\n` +
          `Mission Title: "${mTitle}"\n` +
          `Required Visual Proof: ${rule}\n\n` +
          `Inspect the attached camera image(s) carefully. Rules:\n` +
          `1. Reject if the required object/animal/gesture is NOT clearly visible, or if it's a photo of another phone/laptop screen, a blank wall, a dark/covered camera, or unrelated scene.\n` +
          `2. Accept if the required subject is genuinely visible in at least one frame.\n` +
          `3. Reply ONLY with valid JSON (no markdown, no extra text):\n` +
          `{"passed": true or false, "seen": "وصف قصير بالعامية المصرية للي شفته في الكاميرا فعلياً", "reason": "تعليق روش قصير بالعامية المصرية يوضح ليه قبلت أو رفضت"}`,
      },
    ];

    for (const b64 of framesB64.slice(0, 3)) {
      contentParts.push({
        type: "image_url",
        image_url: { url: "data:image/jpeg;base64," + b64 },
      });
    }

    const visionModels = [
      "meta-llama/llama-4-scout-17b-16e-instruct",
      "meta-llama/llama-4-maverick-17b-128e-instruct",
    ];

    let lastHttpErr = null;
    for (const model of visionModels) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 14000);
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
          lastHttpErr = res.status;
          if (res.status === 401) {
            return {
              ok: false,
              seen: "",
              reason: "مفتاح Groq AI غلط أو منتهي! راجع المفتاح في الإعدادات (≡).",
            };
          }
          continue;
        }

        const j = await res.json();
        const raw = j.choices?.[0]?.message?.content || "";
        const parsed = extractJsonObject(raw);
        if (parsed && typeof parsed.passed === "boolean") {
          return {
            ok: parsed.passed,
            seen: String(parsed.seen || "").trim(),
            reason: String(parsed.reason || (parsed.passed ? "الذكاء الاصطناعي اعتمد اللقطة!" : "اللقطة مش مطابقة للمهمة!")).trim(),
          };
        }
        // Fallback if model replied plain YES/NO
        const upper = raw.toUpperCase();
        if (upper.includes("TRUE") || upper.includes("YES")) {
          return { ok: true, seen: "تم الفحص البصري", reason: "الذكاء الاصطناعي اعتمد اللقطة!" };
        }
        return { ok: false, seen: raw.slice(0, 80), reason: "الذكاء الاصطناعي مش شايف المطلوب في الصورة بوضوح، صوّر تاني!" };
      } catch {}
    }

    return {
      ok: false,
      seen: "",
      reason: lastHttpErr === 429
        ? "سيرفر الذكاء الاصطناعي عليه ضغط لحظي — استنى 5 ثواني وحاول تاني."
        : "فشل الاتصال بسيرفر الذكاء الاصطناعي (Groq Vision) — اتأكد من النت وحاول تاني.",
    };
  }

  // Real Arabic Speech Verification via Groq Whisper for Voice-Dare Missions (e.g. "قول لكلب هاي كلبات")
  async function verifyMissionSpeechWithGroqWhisper(file, mission) {
    const key = getGroqKey();
    if (!key || !mission || !Array.isArray(mission.requiresSpeech) || !mission.requiresSpeech.length) {
      return { checked: false, ok: true, transcript: "" };
    }
    if (!file || file.size > 20 * 1024 * 1024) {
      return { checked: false, ok: true, transcript: "" };
    }

    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "mission.mp4");
      fd.append("model", "whisper-large-v3-turbo");
      fd.append("language", "ar");
      fd.append("prompt", mission.requiresSpeech.join(" "));

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 14000);
      const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Authorization": "Bearer " + key },
        body: fd,
      });
      clearTimeout(timer);

      if (!res.ok) {
        // Unsupported mobile video container codec -> don't hard-block if Vision already passed
        return { checked: false, ok: true, transcript: "" };
      }
      const j = await res.json();
      const transcript = String(j.text || "").trim();
      const normText = normalizeArabic(transcript);
      const targets = mission.requiresSpeech.map(normalizeArabic).filter(Boolean);
      const matched = targets.some((w) => normText.includes(w));
      return {
        checked: true,
        ok: matched,
        transcript,
      };
    } catch {
      return { checked: false, ok: true, transcript: "" };
    }
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
      const maxW = 512;
      const ratio = Math.min(1, maxW / Math.max(1, img.naturalWidth || 512));
      c.width = Math.max(240, Math.round((img.naturalWidth || 512) * ratio));
      c.height = Math.max(180, Math.round((img.naturalHeight || 384) * ratio));
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(imgUrl);

      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      let lum = 0;
      for (let i = 0; i < data.length; i += 24) lum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      maxAvgLum = lum / Math.max(1, data.length / 24);
      frames.push(c.toDataURL("image/jpeg", 0.78).split(",")[1]);
      return { frames, maxAvgLum, isVideo: false };
    }

    // Video: extract up to 3 evenly spaced keyframes (20%, 50%, 80%) so Vision AI catches moving cats/dogs/gestures!
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
    c.width = 400;
    c.height = 300;
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
      frames.push(c.toDataURL("image/jpeg", 0.72).split(",")[1]);
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

  async function analyzeMissionMedia(missionId, file) {
    const st = K.state;
    if (!file || !st.engine) return;

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

    const isVideoFile = Boolean(file.type && file.type.startsWith("video/"));
    if (mission.requiresSpeech && mission.requiresSpeech.length && !isVideoFile) {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = "المهمة دي فيها صوت! لازم تصوّر فيديو قصير عشان الذكاء الاصطناعي يشوف المشهد ويسمع كلامك.";
      K.UI.updateCameraModalStatus();
      return;
    }

    st.videoAnalyzing = true;
    st.videoVerdictTone = "pending";
    st.videoVerdict = isVideoFile
      ? "جاري استخراج اللقطات من الفيديو وفحصها بالذكاء الاصطناعي..."
      : "جاري تحليل الصورة بالذكاء الاصطناعي (Groq Vision)...";
    K.UI.updateCameraModalStatus();

    try {
      const { frames, maxAvgLum } = await extractFramesFromFile(file);

      if (maxAvgLum < 9) {
        st.videoAnalyzing = false;
        st.videoVerdictTone = "error";
        st.videoVerdict = "الكاميرا ضلمة كحل! شيل إيدك من على العدسة وصوّر المهمة بوضوح.";
        K.UI.updateCameraModalStatus();
        return;
      }

      // 1. Visual AI Verification (Groq Vision)
      const vision = await verifyMissionWithGroqVision(frames, mission);
      if (!vision.ok) {
        st.videoAnalyzing = false;
        st.videoVerdictTone = "error";
        st.videoVerdict = (vision.seen ? `الذكاء الاصطناعي شاف: «${vision.seen}» — ` : "") + vision.reason;
        K.UI.updateCameraModalStatus();
        return;
      }

      // 2. Speech AI Verification (Groq Whisper) for voice-dare missions
      let speechNote = "";
      if (mission.requiresSpeech && mission.requiresSpeech.length && isVideoFile) {
        st.videoVerdict = `البصر تمام (${vision.seen || "مظبوط"}) — جاري فحص الصوت بـ Whisper AI...`;
        K.UI.updateCameraModalStatus();
        const speech = await verifyMissionSpeechWithGroqWhisper(file, mission);
        if (speech.checked && !speech.ok) {
          st.videoAnalyzing = false;
          st.videoVerdictTone = "error";
          const heard = speech.transcript ? `سمعت: «${speech.transcript}»` : "مسمعتش صوت واضح";
          st.videoVerdict = `الذكاء الاصطناعي شاف المشهد صح، بس ${heard} — علّي صوتك وقول المطلوب بوضوح في الفيديو!`;
          K.UI.updateCameraModalStatus();
          return;
        }
        if (speech.checked && speech.transcript) {
          speechNote = ` • صوتك: «${speech.transcript.slice(0, 40)}»`;
        }
      }

      // PASSED BOTH VISION (+ SPEECH IF REQUIRED)!
      const summaryVerdict = `${vision.seen ? `AI شاف: ${vision.seen} — ` : ""}${vision.reason}${speechNote}`;
      st.videoAnalyzing = false;
      st.videoVerdictTone = "success";
      st.videoVerdict = "تم الاعتماد بالذكاء الاصطناعي! " + summaryVerdict;
      K.UI.updateCameraModalStatus();
      K.SFX.play("win");

      setTimeout(() => {
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
    } catch (err) {
      st.videoAnalyzing = false;
      st.videoVerdictTone = "error";
      st.videoVerdict = err && err.message === "TOO_LONG"
        ? "الفيديو أطول من 25 ثانية — صوّر فيديو قصير (3 لـ 8 ثواني) عشان يتحلل بسرعة!"
        : "معرفتش أقرأ الملف — جرّب تصوّر لقطة قصيرة تاني.";
      K.UI.updateCameraModalStatus();
    }
  }

  K.AI = {
    callGroqChat,
    verifyMissionWithGroqVision,
    verifyMissionSpeechWithGroqWhisper,
    triggerProfilerReport,
    generateMatchRecap,
    analyzeMissionMedia,
  };
})(window.Kameen);
