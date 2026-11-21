"use strict";

window.Kameen = window.Kameen || {};

(function (K) {
  async function callGroqChat(systemPrompt, userPrompt, maxTokens = 130) {
    const key = ((K.state && K.state.groqKey) || K.CONFIG.DEFAULT_GROQ_KEY || "").trim();
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

  async function verifyFrameWithGroqVision(b64Jpeg) {
    const key = ((K.state && K.state.groqKey) || K.CONFIG.DEFAULT_GROQ_KEY || "").trim();
    if (!key) return { ok: true, reason: "تحقق محلي سريع" };
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "meta-llama/llama-4-scout-17b-16e-instruct",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Is this a real camera photo of a real environment or object (not a completely black/covered lens or solid blank screen)? Reply ONLY with YES or NO.",
                },
                {
                  type: "image_url",
                  image_url: { url: "data:image/jpeg;base64," + b64Jpeg },
                },
              ],
            },
          ],
          max_tokens: 10,
        }),
      });
      clearTimeout(timer);
      if (res.ok) {
        const j = await res.json();
        const ans = (j.choices?.[0]?.message?.content || "YES").toUpperCase();
        if (ans.includes("NO")) {
          return { ok: false, reason: "الذكاء الاصطناعي شايف إن الكاميرا متغطية أو اللقطة مش حقيقية! صوّر المكان بوضوح." };
        }
        return { ok: true, reason: "Groq Vision اعتمد اللقطة!" };
      }
    } catch {}
    return { ok: true, reason: "تم التحقق المحلي" };
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
        "ممنوع تذكر أي أسماء لاعبين. اكتب جملتين قصار ومباشرين مبنيين على البيانات الحقيقية.";

      const userPrompt =
        `بيانات الميدان الآن: عدد الأحياء ${summary.livingCount}، ` +
        `توزيع القطاعات ${JSON.stringify(summary.sectorCounts)}، ` +
        `عدد الجثث ${summary.bodiesCount}، ` +
        `نص قطر الزون ${summary.zoneRadiusMeters}م، ` +
        `وضع الخاتمة السخنة: ${summary.showdownActive ? "شغال" : "لسه"}، ` +
        `هل فيه لاعب جري بسرعة فجأة؟ ${summary.sprinterSector || "لأ"}، ` +
        `هل فيه لاعب مكمبر مكانه كتير؟ ${summary.camperSector || "لأ"}، ` +
        `هل اتنين قربوا من بعض جداً؟ ${summary.encounterSector || "لأ"}.`;

      let text = await callGroqChat(sysPrompt, userPrompt, 130);
      const source = text ? "groq" : "local";

      if (!text) {
        const busy = Object.entries(summary.sectorCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "القطاع المركزي";
        if (summary.sprinterSector) {
          text = `يا رجالة صحصحوا! في واحد طار جري فجأة في ${summary.sprinterSector}.. يا إما عمل عملة وبيهرب يا إما مرعوب!`;
        } else if (summary.camperSector) {
          text = `رادار السلوك لقط حد مكمبر مكانه بقاله حبة في ${summary.camperSector}.. يا ترى مستخبي ولا عامل كمين؟`;
        } else if (summary.encounterSector) {
          text = `اتنين قربوا من بعض أوي في ${summary.encounterSector}.. هل ده تحالف ولا كانت خناقة على نضافة؟`;
        } else {
          text = summary.bodiesCount > 0
            ? `الجو ولّع حوالين ${busy}! فيه ${summary.bodiesCount} ضحية لحد دلوقتي والزون بقت ${summary.zoneRadiusMeters}م!`
            : `الزحمة كلها حوالين ${busy} بين ${summary.livingCount} لاعبين أحياء.. متأمنش للي ماشي وراك!`;
        }
      }

      st.engine.addAIReport(text, source, st.simTimeMs);
      st.lastIntel = `🤖 المحلل (${source === "groq" ? "AI لايف" : "رادار"}): ${text}`;
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
          box.textContent = "🤖 تعليق المحلل: " + recap;
          box.classList.remove("hidden");
        }
      }
    }
  }

  // Supports BOTH quick Photo (image/*) AND short Video (video/*) proof!
  async function analyzeMissionMedia(missionId, file) {
    const st = K.state;
    if (!file || !st.engine) return;
    st.videoAnalyzing = true;
    st.videoVerdict = "⏳ الذكاء الاصطناعي بيفحص اللقطة والموقع...";
    K.UI.updateCameraModalStatus();

    try {
      let avgLum = 0;
      let b64 = "";

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
        c.width = 320; c.height = 240;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, 320, 240);
        URL.revokeObjectURL(imgUrl);
        const data = ctx.getImageData(0, 0, 320, 240).data;
        for (let i = 0; i < data.length; i += 16) avgLum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        avgLum /= (data.length / 16);
        b64 = c.toDataURL("image/jpeg", 0.65).split(",")[1];
      } else {
        const url = URL.createObjectURL(file);
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.playsInline = true;
        await new Promise((res, rej) => {
          video.onloadedmetadata = res;
          video.onerror = rej;
          setTimeout(() => rej(new Error("timeout")), 8000);
        });
        if (video.duration > 20) {
          URL.revokeObjectURL(url);
          st.videoAnalyzing = false;
          st.videoVerdict = "❌ الفيديو طويل شوية (الحد الأقصى 20 ثانية) — صوّر لقطة أسرع أو صورة!";
          K.UI.updateCameraModalStatus();
          return;
        }
        video.currentTime = Math.min(1.0, Math.max(0.1, (video.duration || 1) * 0.5));
        await new Promise((r) => { video.onseeked = r; setTimeout(r, 900); });
        const c = document.createElement("canvas");
        c.width = 320; c.height = 240;
        const ctx = c.getContext("2d");
        ctx.drawImage(video, 0, 0, 320, 240);
        URL.revokeObjectURL(url);
        const data = ctx.getImageData(0, 0, 320, 240).data;
        for (let i = 0; i < data.length; i += 16) avgLum += (data[i] + data[i + 1] + data[i + 2]) / 3;
        avgLum /= (data.length / 16);
        b64 = c.toDataURL("image/jpeg", 0.65).split(",")[1];
      }

      if (avgLum < 7) {
        st.videoAnalyzing = false;
        st.videoVerdict = "❌ اللقطة ضلمة كحل! شيل صباعك من ع الكاميرا وصوّر المكان.";
        K.UI.updateCameraModalStatus();
        return;
      }

      const check = await verifyFrameWithGroqVision(b64);
      if (!check.ok) {
        st.videoAnalyzing = false;
        st.videoVerdict = "❌ " + check.reason;
        K.UI.updateCameraModalStatus();
        return;
      }

      st.videoAnalyzing = false;
      st.videoVerdict = null;
      st.modal = null;
      K.UI.renderModal();
      K.App.dispatchAction("MISSION_COMPLETE", { missionId, videoVerified: true });
    } catch {
      st.videoAnalyzing = false;
      st.videoVerdict = "❌ معرفتش أقرأ الملف — جرب تاخد صورة سريعة تاني.";
      K.UI.updateCameraModalStatus();
    }
  }

  K.AI = {
    callGroqChat,
    verifyFrameWithGroqVision,
    triggerProfilerReport,
    generateMatchRecap,
    analyzeMissionMedia,
  };
})(window.Kameen);
