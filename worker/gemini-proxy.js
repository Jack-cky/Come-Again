// Cloudflare Worker: Gemini proxy for Come Again. The API key lives here as
// a Worker secret, so the static site never ships it. The model is set
// server-side via the GEMINI_MODEL var, so a leaked Worker URL still cannot
// be used against arbitrary models.
const DEFAULT_MODEL = "gemini-2.5-flash";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!allowedOrigins.includes(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    // ponytail: no rate limiting; the free-tier Gemini quota is the cap and
    // the Origin check keeps other websites out. Add a KV or Durable Object
    // counter here if quota abuse ever shows up.
    const model = env.GEMINI_MODEL || DEFAULT_MODEL;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const upstream = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.GEMINI_API_KEY,
      },
      body: request.body,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  },
};
