var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": [
    "Content-Type",
    "x-api-key",
    "anthropic-version",
    "anthropic-dangerous-allow-browser",
    "Authorization"
  ].join(", "),
  "Access-Control-Max-Age": "86400"
};
function corsHeaders(extra = {}) {
  return { ...CORS, "Content-Type": "application/json", ...extra };
}
__name(corsHeaders, "corsHeaders");
function ok(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: corsHeaders() });
}
__name(ok, "ok");
function err(message, status = 400) {
  return new Response(JSON.stringify({ error: message }), { status, headers: corsHeaders() });
}
__name(err, "err");
function percentEncode(str) {
  return encodeURIComponent(String(str)).replace(/!/g, "%21").replace(/'/g, "%27").replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/\*/g, "%2A");
}
__name(percentEncode, "percentEncode");
async function hmacSha1(key, data) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
__name(hmacSha1, "hmacSha1");
async function buildOAuthHeader(method, url, params, creds) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1e3).toString();
  const oauthParams = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: creds.accessToken,
    oauth_version: "1.0"
  };
  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr = sortedKeys.map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join("&");
  const baseStr = [method.toUpperCase(), percentEncode(url), percentEncode(paramStr)].join("&");
  const signingKey = `${percentEncode(creds.apiSecret)}&${percentEncode(creds.accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, baseStr);
  const headerParams = { ...oauthParams, oauth_signature: signature };
  const headerStr = Object.keys(headerParams).map((k) => `${percentEncode(k)}="${percentEncode(headerParams[k])}"`).join(", ");
  return `OAuth ${headerStr}`;
}
__name(buildOAuthHeader, "buildOAuthHeader");
function extractArticleLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = [];
  const anchorRe = /<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    let href = m[1];
    const rawText = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!rawText || rawText.length < 5) continue;
    try {
      href = new URL(href, base.origin).href;
    } catch {
      continue;
    }
    try {
      const u = new URL(href);
      if (u.hostname !== base.hostname) continue;
      if (!/\/\d{4,}|\/article|\/news|\/topics|\/column|\/report|\/story|\/press/i.test(u.pathname)) continue;
      href = u.origin + u.pathname;
    } catch {
      continue;
    }
    if (!links.find((l) => l.url === href)) {
      links.push({ url: href, title: rawText.slice(0, 80) });
    }
    if (links.length >= 10) break;
  }
  return links;
}
__name(extractArticleLinks, "extractArticleLinks");
async function postTweet(text, replyToId, creds) {
  const url = "https://api.twitter.com/2/tweets";
  const body = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  const oauthHeader = await buildOAuthHeader("POST", url, {}, creds);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: oauthHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("[X API error]", res.status, JSON.stringify(data));
    throw new Error(data.detail || data.title || `X API error ${res.status}`);
  }
  return data.data;
}
__name(postTweet, "postTweet");
var worker_default = {
  async fetch(request, env) {
    const { method, url } = request;
    const path = new URL(url).pathname;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (method === "POST" && path === "/claude") {
      try {
        const bodyText = await request.text();
        let bodyObj;
        try {
          bodyObj = JSON.parse(bodyText);
        } catch {
          bodyObj = {};
        }
        const apiKey = request.headers.get("x-api-key") || env.CLAUDE_API_KEY;
        if (!apiKey) return err("Claude API\u30AD\u30FC\u304C\u8A2D\u5B9A\u3055\u308C\u3066\u3044\u307E\u305B\u3093", 401);
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": request.headers.get("anthropic-version") || "2023-06-01",
            "content-type": "application/json"
          },
          body: bodyText
        });
        if (bodyObj.stream === true) {
          if (!claudeRes.ok) {
            const errText = await claudeRes.text();
            let errMsg = `HTTP ${claudeRes.status}`;
            try {
              const j = JSON.parse(errText);
              errMsg = j?.error?.message || errMsg;
            } catch {
            }
            return new Response(
              JSON.stringify({ error: { type: "api_error", message: errMsg } }),
              { status: claudeRes.status, headers: corsHeaders() }
            );
          }
          return new Response(claudeRes.body, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": CORS["Access-Control-Allow-Headers"]
            }
          });
        }
        const rawText = await claudeRes.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch {
          return new Response(
            JSON.stringify({ error: { type: "parse_error", message: `Non-JSON response: ${rawText.slice(0, 200)}` } }),
            { status: claudeRes.status, headers: corsHeaders() }
          );
        }
        if (!claudeRes.ok) {
          const errMsg = data?.error?.message || data?.message || `HTTP ${claudeRes.status}`;
          const errType = data?.error?.type || "api_error";
          return new Response(
            JSON.stringify({ error: { type: errType, message: errMsg } }),
            { status: claudeRes.status, headers: corsHeaders() }
          );
        }
        return new Response(JSON.stringify(data), {
          status: claudeRes.status,
          headers: corsHeaders()
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ error: { type: "proxy_error", message: e.message || "Unknown proxy error" } }),
          { status: 500, headers: corsHeaders() }
        );
      }
    }
    if (method === "POST" && path === "/tweet") {
      try {
        const { text, apiKey, apiSecret, accessToken, accessTokenSecret } = await request.json();
        if (!text) return err("text is required");
        const creds = {
          apiKey: apiKey || env.X_API_KEY,
          apiSecret: apiSecret || env.X_API_SECRET,
          accessToken: accessToken || env.X_ACCESS_TOKEN,
          accessTokenSecret: accessTokenSecret || env.X_ACCESS_TOKEN_SECRET
        };
        if (!creds.apiKey) return err("X API credentials are not configured", 401);
        const tweet = await postTweet(text, null, creds);
        return ok({ success: true, tweet });
      } catch (e) {
        console.error("[/tweet error]", e.message);
        return err(e.message, 500);
      }
    }
    if (method === "POST" && path === "/thread") {
      try {
        const { texts, apiKey, apiSecret, accessToken, accessTokenSecret } = await request.json();
        if (!texts || !texts.length) return err("texts is required");
        const creds = {
          apiKey: apiKey || env.X_API_KEY,
          apiSecret: apiSecret || env.X_API_SECRET,
          accessToken: accessToken || env.X_ACCESS_TOKEN,
          accessTokenSecret: accessTokenSecret || env.X_ACCESS_TOKEN_SECRET
        };
        if (!creds.apiKey) return err("X API credentials are not configured", 401);
        const tweets = [];
        let replyToId = null;
        for (const text of texts) {
          const tweet = await postTweet(text, replyToId, creds);
          tweets.push(tweet);
          replyToId = tweet.id;
        }
        return ok({ success: true, tweets });
      } catch (e) {
        console.error("[/thread error]", e.message);
        return err(e.message, 500);
      }
    }
    if (method === "POST" && path === "/fetch-news") {
      try {
        const { url: targetUrl } = await request.json();
        if (!targetUrl) return err("url is required");
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5e3);
        let html;
        try {
          const res = await fetch(targetUrl, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; ShunBot/1.0)" }
          });
          clearTimeout(timer);
          if (!res.ok) return ok({ site: targetUrl, url: targetUrl, links: [], count: 0, error: `HTTP ${res.status}` });
          html = await res.text();
        } catch (fetchErr) {
          clearTimeout(timer);
          return ok({ site: targetUrl, url: targetUrl, links: [], count: 0, error: fetchErr.message });
        }
        const links = extractArticleLinks(html, targetUrl);
        return ok({ site: new URL(targetUrl).hostname, url: targetUrl, links, count: links.length });
      } catch (e) {
        return err("/fetch-news error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/search-tweets") {
      try {
        const { query, apiKey, count, cursor } = await request.json();
        if (!query) return err("query is required");
        const key = apiKey || env.SOCIAL_DATA_API_KEY;
        if (!key) return err("SocialData API Key is not configured", 401);
        const fetchCount = Math.min(Math.max(parseInt(count) || 20, 1), 100);
        let searchUrl = `https://api.socialdata.tools/twitter/search?query=${encodeURIComponent(query)}&type=Latest&count=${fetchCount}`;
        if (cursor) searchUrl += `&cursor=${encodeURIComponent(cursor)}`;
        const sdRes = await fetch(searchUrl, {
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: "application/json"
          }
        });
        const data = await sdRes.json();
        if (!sdRes.ok) return err(`SocialData error: ${data.message || sdRes.status}`, sdRes.status);
        return ok(data);
      } catch (e) {
        return err("/search-tweets error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/gemini-image") {
      try {
        const { prompt, model: reqModel, resolution, characterImageBase64, characterMimeType, geminiApiKey } = await request.json();
        if (!prompt) return err("prompt is required");
        const apiKey = geminiApiKey || env.GEMINI_API_KEY;
        if (!apiKey) return err("Gemini API Key is not configured", 401);
        const model = reqModel || "imagen-3.0-generate-003";
        const isImagen = model.startsWith("imagen");
        let geminiRes;
        if (isImagen) {
          const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
          const parameters = { sampleCount: 1 };
          if (resolution === "4K") parameters.aspectRatio = "16:9";
          else parameters.aspectRatio = "16:9";
          geminiRes = await fetch(imagenUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instances: [{ prompt }], parameters })
          });
          const data = await geminiRes.json();
          if (!geminiRes.ok) {
            return err(`Imagen API error: ${data.error?.message || geminiRes.status}`, geminiRes.status);
          }
          const pred = data.predictions?.[0];
          if (!pred?.bytesBase64Encoded) return err("No image in Imagen response", 500);
          return ok({
            imageBase64: pred.bytesBase64Encoded,
            mimeType: pred.mimeType || "image/png"
          });
        } else {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
          const parts = [];
          if (characterImageBase64 && characterMimeType) {
            parts.push({ inline_data: { mime_type: characterMimeType, data: characterImageBase64 } });
          }
          parts.push({ text: prompt });
          geminiRes = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts }],
              generationConfig: { responseModalities: ["image", "text"] }
            })
          });
          const data = await geminiRes.json();
          if (!geminiRes.ok) {
            return err(`Gemini API error: ${data.error?.message || geminiRes.status}`, geminiRes.status);
          }
          const imagePart = data.candidates?.[0]?.content?.parts?.find((p) => p.inline_data);
          if (!imagePart) return err("No image in Gemini response", 500);
          return ok({
            imageBase64: imagePart.inline_data.data,
            mimeType: imagePart.inline_data.mime_type || "image/png"
          });
        }
      } catch (e) {
        return err("/gemini-image error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/get-user") {
      try {
        const body = await request.json().catch(() => ({}));
        const handle = (body.handle || "").replace(/^@/, "");
        if (!handle) return err("handle is required");
        const key = body.apiKey || env.SOCIAL_DATA_API_KEY;
        if (!key) return err("SocialData API Key is not configured", 401);
        const sdRes = await fetch(`https://api.socialdata.tools/twitter/user/${encodeURIComponent(handle)}`, {
          headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
        });
        const data = await sdRes.json();
        if (!sdRes.ok) return err(`SocialData user error: ${data.message || sdRes.status}`, sdRes.status);
        return ok({
          followers_count: data.followers_count ?? null,
          name: data.name || handle,
          screen_name: data.screen_name || handle
        });
      } catch (e) {
        return err("/get-user error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/get-trends") {
      try {
        const rssUrl = "https://trends.google.co.jp/trends/trendingsearches/daily/rss?geo=JP";
        const rssRes = await fetch(rssUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; ShunBot/1.0)",
            "Accept": "application/rss+xml, application/xml, text/xml"
          }
        });
        if (!rssRes.ok) return err(`Google Trends RSS error: HTTP ${rssRes.status}`, rssRes.status);
        const xml = await rssRes.text();
        const titleMatches = [...xml.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)];
        const trafficMatches = [...xml.matchAll(/<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>/g)];
        const trends = titleMatches.slice(1).slice(0, 20).map((m, i) => ({
          name: (m[1] || m[2] || "").trim(),
          traffic: trafficMatches[i] ? trafficMatches[i][1].trim() : null
        })).filter((t) => t.name.length > 0);
        if (trends.length === 0) return err("\u30C8\u30EC\u30F3\u30C9\u30C7\u30FC\u30BF\u304C\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F", 502);
        return ok({ trends, source: "google_trends" });
      } catch (e) {
        return err("/get-trends error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/web-search") {
      try {
        const { query } = await request.json();
        if (!query) return err("query is required");
        const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1&skip_disambig=1`;
        const res = await fetch(ddgUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; factcheck-bot/1.0)" }
        });
        if (!res.ok) return err(`DuckDuckGo error: ${res.status}`, 502);
        const data = await res.json();
        const snippets = [];
        if (data.AbstractText) {
          snippets.push(`[${data.AbstractSource || "Wikipedia"}] ${data.AbstractText.slice(0, 300)}`);
        }
        (data.RelatedTopics || []).slice(0, 4).forEach((t) => {
          if (t.Text) snippets.push(t.Text.slice(0, 200));
        });
        (data.Results || []).slice(0, 3).forEach((r) => {
          if (r.Text) snippets.push(`[${r.FirstURL || ""}] ${r.Text.slice(0, 200)}`);
        });
        return ok({ query, snippets });
      } catch (e) {
        return err("/web-search error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/rakuten-search") {
      try {
        const body = await request.json().catch(() => ({}));
        const appId = env.RAKUTEN_APP_ID;
        const affiliateId = env.RAKUTEN_AFFILIATE_ID;
        if (!appId) return err("Rakuten App ID is not configured", 401);
        const endpoint = "https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401";
        const params = new URLSearchParams();
        params.set("applicationId", appId);
        if (env.RAKUTEN_ACCESS_KEY) params.set("accessKey", env.RAKUTEN_ACCESS_KEY);
        if (affiliateId) params.set("affiliateId", affiliateId);
        params.set("format", "json");
        params.set("formatVersion", "2");
        params.set("hits", String(Math.min(Math.max(parseInt(body.hits) || 30, 1), 30)));
        if (body.keyword) params.set("keyword", body.keyword);
        if (body.itemCode) params.set("itemCode", body.itemCode);
        if (body.shopCode) params.set("shopCode", body.shopCode);
        if (body.genreId) params.set("genreId", String(body.genreId));
        if (body.minPrice) params.set("minPrice", String(body.minPrice));
        if (body.maxPrice) params.set("maxPrice", String(body.maxPrice));
        if (body.sort) params.set("sort", body.sort);
        if (body.hasReviewFlag) params.set("hasReviewFlag", "1");
        params.set("availability", body.availability != null ? String(body.availability) : "1");
        const rakutenRes = await fetch(`${endpoint}?${params.toString()}`, {
          headers: {
            "Accept": "application/json",
            "Referer": "https://x-api-proxy.tamura-0528-2938.workers.dev",
            "Origin": "https://x-api-proxy.tamura-0528-2938.workers.dev"
          }
        });
        const data = await rakutenRes.json();
        if (!rakutenRes.ok) {
          return err(`Rakuten API error: ${data.error_description || data.error || rakutenRes.status}`, rakutenRes.status);
        }
        return ok(data);
      } catch (e) {
        return err("/rakuten-search error: " + e.message, 500);
      }
    }
    if (method === "POST" && path === "/typefully-draft") {
      try {
        const body = await request.json().catch(() => ({}));
        const apiKey = body.apiKey || env.TYPEFULLY_API_KEY;
        if (!apiKey) return err("Typefully API Key is not configured", 401);
        if (!body.content) return err("content is required");
        const payload = { content: body.content };
        if (body.threadify != null) payload.threadify = body.threadify;
        if (body["schedule-date"]) payload["schedule-date"] = body["schedule-date"];
        if (body["auto_retweet_enabled"] != null) payload.auto_retweet_enabled = body["auto_retweet_enabled"];
        const tfRes = await fetch("https://api.typefully.com/v1/drafts/", {
          method: "POST",
          headers: {
            "X-API-KEY": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });
        const data = await tfRes.json().catch(() => ({}));
        if (!tfRes.ok) {
          return err(`Typefully error: ${data.detail || data.message || tfRes.status}`, tfRes.status);
        }
        return ok(data);
      } catch (e) {
        return err("/typefully-draft error: " + e.message, 500);
      }
    }
    return err("Not found", 404);
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
