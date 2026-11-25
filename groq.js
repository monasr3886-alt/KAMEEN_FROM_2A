"use strict";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  const envKey = String(process.env.GROQ_API_KEY || "").trim();
  if (!envKey) {
    return res.status(503).json({
      ok: false,
      error: "GROQ_API_KEY غير مضبوط في متغيرات البيئة على Vercel",
    });
  }

  try {
    let body = req.body;
    if (typeof body === "string") {
      body = JSON.parse(body || "{}");
    }
    const action = (body && body.action) || "chat";

    if (action === "models") {
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer " + envKey },
      });
      const txt = await r.text();
      return res.status(r.status).type("application/json").send(txt);
    }

    if (action === "chat") {
      const payload = {
        model: body.model || "llama-3.3-70b-versatile",
        messages: Array.isArray(body.messages) ? body.messages : [],
        temperature: typeof body.temperature === "number" ? body.temperature : 0.7,
        max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : 160,
      };
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + envKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const txt = await r.text();
      return res.status(r.status).type("application/json").send(txt);
    }

    return res.status(400).json({ ok: false, error: "Unknown action" });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : "Proxy error"),
    });
  }
};
