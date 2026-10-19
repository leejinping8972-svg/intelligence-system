// ../workers/site-discovery/data/trends-snapshots.json
var trends_snapshots_default = [
  {
    keyword: "women's health gummies",
    market: "US",
    period: "today 12-m",
    resolution: "week",
    collectedAt: "2026-10-15T09:14:07.836118+00:00",
    sourceUrl: "https://trends.google.com/trends/explore?date=today%2012-m&geo=US&q=women%27s%20health%20gummies",
    collectionMethod: "official-page-table",
    points: [
      {
        date: "2025-10-12",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-10-19",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-10-26",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-11-02",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-11-09",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-11-16",
        value: 3,
        isPartial: false
      },
      {
        date: "2025-11-23",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-11-30",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-12-07",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-12-14",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-12-21",
        value: 0,
        isPartial: false
      },
      {
        date: "2025-12-28",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-01-04",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-01-11",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-01-18",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-01-25",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-02-01",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-02-08",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-02-15",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-02-22",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-03-01",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-03-08",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-03-15",
        value: 5,
        isPartial: false
      },
      {
        date: "2026-03-22",
        value: 20,
        isPartial: false
      },
      {
        date: "2026-03-29",
        value: 62,
        isPartial: false
      },
      {
        date: "2026-04-05",
        value: 88,
        isPartial: false
      },
      {
        date: "2026-04-12",
        value: 100,
        isPartial: false
      },
      {
        date: "2026-04-19",
        value: 64,
        isPartial: false
      },
      {
        date: "2026-04-26",
        value: 38,
        isPartial: false
      },
      {
        date: "2026-05-03",
        value: 39,
        isPartial: false
      },
      {
        date: "2026-05-10",
        value: 67,
        isPartial: false
      },
      {
        date: "2026-05-17",
        value: 67,
        isPartial: false
      },
      {
        date: "2026-05-24",
        value: 33,
        isPartial: false
      },
      {
        date: "2026-05-31",
        value: 39,
        isPartial: false
      },
      {
        date: "2026-06-07",
        value: 48,
        isPartial: false
      },
      {
        date: "2026-06-14",
        value: 42,
        isPartial: false
      },
      {
        date: "2026-06-21",
        value: 33,
        isPartial: false
      },
      {
        date: "2026-06-28",
        value: 9,
        isPartial: false
      },
      {
        date: "2026-07-05",
        value: 7,
        isPartial: false
      },
      {
        date: "2026-07-12",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-07-19",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-07-26",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-08-02",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-08-09",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-08-16",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-08-23",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-08-30",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-09-06",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-09-13",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-09-20",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-09-27",
        value: 0,
        isPartial: false
      },
      {
        date: "2026-10-04",
        value: 1,
        isPartial: false
      },
      {
        date: "2026-10-11",
        value: 0,
        isPartial: true
      }
    ]
  }
];

// ../workers/site-discovery/src/provider-config.js
var STORAGE_KEY = "provider:sorftime:mcp:v1";
var encode = (value) => btoa(String.fromCodePoint(...value));
var decode = (value) => Uint8Array.from(atob(value), (letter) => letter.codePointAt(0));
async function encryptionKey(env) {
  if (!env.PROVIDER_CONFIG_ENCRYPTION_KEY || !env.PROVIDER_CONFIG)
    throw new Error("\u4E91\u7AEF\u5BC6\u94A5\u5B58\u50A8\u5C1A\u672A\u542F\u7528\uFF0C\u8BF7\u8054\u7CFB\u7BA1\u7406\u5458\u5B8C\u6210\u90E8\u7F72");
  return crypto.subtle.importKey(
    "raw",
    decode(env.PROVIDER_CONFIG_ENCRYPTION_KEY),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"]
  );
}
async function saveSorftimeToken(input, env) {
  const token = typeof input.sorftimeToken === "string" ? input.sorftimeToken.trim() : "";
  if (token.length < 10 || token.length > 4096 || /\s|https?:\/\//i.test(token))
    throw new Error(
      "\u8BF7\u586B\u5199 MCP ACCESS TOKEN \u672C\u8EAB\uFF0C\u4E0D\u8981\u7C98\u8D34\u5B8C\u6574\u7F51\u5740\uFF1B\u7559\u7A7A\u4E0D\u4F1A\u6E05\u9664\u539F\u5BC6\u94A5"
    );
  const key = await encryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(STORAGE_KEY)
    },
    key,
    new TextEncoder().encode(token)
  );
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await env.PROVIDER_CONFIG.put(
    STORAGE_KEY,
    JSON.stringify({
      iv: encode(iv),
      ciphertext: encode(new Uint8Array(ciphertext)),
      updatedAt
    })
  );
  return {
    configured: true,
    updatedAt,
    message: "Token \u5DF2\u52A0\u5BC6\u4FDD\u5B58\u5230\u4E91\u7AEF\uFF0C\u9875\u9762\u4E0D\u56DE\u663E\u5BC6\u94A5\uFF1B\u5168\u7403\u540C\u6B65\u53EF\u80FD\u9700\u8981\u7EA6\u4E00\u5206\u949F"
  };
}
async function readSorftimeToken(env) {
  if (env.PROVIDER_CONFIG && env.PROVIDER_CONFIG_ENCRYPTION_KEY) {
    const saved = await env.PROVIDER_CONFIG.get(STORAGE_KEY, "json");
    if (saved) {
      try {
        const key = await encryptionKey(env);
        const value = await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: decode(saved.iv),
            additionalData: new TextEncoder().encode(STORAGE_KEY)
          },
          key,
          decode(saved.ciphertext)
        );
        return new TextDecoder().decode(value);
      } catch {
        throw new Error("\u4E91\u7AEF\u5BC6\u94A5\u89E3\u5BC6\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u4FDD\u5B58 Sorftime Token");
      }
    }
  }
  return env.SORFTIME_MCP_TOKEN || "";
}

// ../workers/site-discovery/src/server-relay.js
var SERVER_ACTIONS = /* @__PURE__ */ new Set([
  "server_cancel",
  "server_clear_keywords",
  "server_import_keywords",
  "server_patch_keywords",
  "server_snapshot",
  "server_status",
  "server_submit"
]);
async function serverRelay(input, env, fetcher = fetch) {
  if (!env.SERVER_API_URL || !env.SERVER_BRIDGE_KEY)
    throw new Error("\u817E\u8BAF\u4E91\u4E1A\u52A1\u670D\u52A1\u5C1A\u672A\u63A5\u901A\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5");
  const url = new URL(env.SERVER_API_URL);
  if (url.protocol !== "https:") throw new Error("\u4E91\u7AEF\u4E1A\u52A1\u670D\u52A1\u5FC5\u987B\u4F7F\u7528HTTPS");
  const response = await fetcher(url.toString(), {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-server-key": env.SERVER_BRIDGE_KEY
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(25e3)
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error("\u4E1A\u52A1\u670D\u52A1\u8FD4\u56DE\u91CD\u5B9A\u5411\uFF0C\u5DF2\u505C\u6B62\u8F6C\u53D1\u8BBF\u95EE\u5BC6\u94A5");
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || `\u817E\u8BAF\u4E91\u4E1A\u52A1\u670D\u52A1HTTP ${response.status}`);
  return payload;
}

// ../workers/site-discovery/src/sorftime.js
var MCP_URL = "https://mcp.sorftime.com/";
var SOURCE = "Sorftime \xB7 Amazon";
var TOOLS = {
  keyword_extends: { keyword: "keyword", market: "keyword_support_site" },
  keyword_related_words: { keyword: "searchKeyword", market: "amzSite" }
};
var MARKETS = /* @__PURE__ */ new Set(["MX", "US"]);
function safeError(message, token) {
  return String(message || "Sorftime MCP \u8C03\u7528\u5931\u8D25").replaceAll(token || "\0", "[redacted]").replaceAll(/https:\/\/mcp\.sorftime\.com[^\s"<>]*/gi, "Sorftime MCP");
}
function parseMcpResponse(text, id) {
  const documents = text.trim().startsWith("{") ? [text] : text.split(/\r?\n\r?\n/).map(
    (event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")
  );
  for (const document of documents) {
    if (!document.trim()) continue;
    let payload;
    try {
      payload = JSON.parse(document);
    } catch {
      continue;
    }
    if (payload.id !== id) continue;
    if (payload.error) throw new Error(payload.error.message || "MCP \u534F\u8BAE\u9519\u8BEF");
    if (payload.result === void 0) throw new Error("MCP \u8FD4\u56DE\u7F3A\u5C11\u7ED3\u679C");
    return payload.result;
  }
  throw new Error("Sorftime MCP \u672A\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u54CD\u5E94");
}
async function readMcpResult(response, id) {
  if (!response.body) throw new Error("Sorftime MCP \u8FD4\u56DE\u7A7A\u54CD\u5E94");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return parseMcpResponse(text, id);
      text += decoder.decode(chunk.value, { stream: true });
      if (text.length > 4e6)
        throw new Error("Sorftime \u8FD4\u56DE\u6570\u636E\u8FC7\u5927\uFF0C\u8BF7\u51CF\u5C11\u7ED3\u679C\u6570\u91CF");
      try {
        return parseMcpResponse(text, id);
      } catch (error) {
        if (error.message !== "Sorftime MCP \u672A\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u54CD\u5E94") throw error;
      }
    }
  } finally {
    await reader.cancel();
  }
}
async function connect(token, fetcher = fetch, productTools = false) {
  if (!token) throw new Error("\u8BF7\u5148\u5728\u6570\u636E\u6E90\u4E0E\u8BBE\u7F6E\u4FDD\u5B58 Sorftime MCP Token");
  const url = new URL(MCP_URL);
  url.searchParams.set("key", token);
  let session;
  let protocol;
  let sequence = 0;
  const rpc = async (method, params, notify = false) => {
    const id = ++sequence;
    const response = await fetcher(url.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": "intelligence-system/1.0 Sorftime-MCP-client",
        ...session ? { "mcp-session-id": session } : {},
        ...protocol ? { "mcp-protocol-version": protocol } : {}
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        ...notify ? {} : { id },
        method,
        params
      }),
      redirect: "manual",
      signal: AbortSignal.timeout(25e3)
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(
        "Sorftime MCP \u8FD4\u56DE\u91CD\u5B9A\u5411\uFF0C\u5DF2\u505C\u6B62\u8F6C\u53D1\u4EE5\u4FDD\u62A4 Token\uFF0C\u8BF7\u68C0\u67E5\u670D\u52A1\u5730\u5740"
      );
    }
    session = response.headers.get("mcp-session-id") || session;
    if (!response.ok) {
      const detail = safeError(await response.text(), token).slice(0, 400);
      throw new Error(
        `Sorftime MCP ${method} \u8FD4\u56DEHTTP ${response.status}\uFF1A${detail}`
      );
    }
    if (notify) {
      await response.body?.cancel();
      return;
    }
    return readMcpResult(response, id);
  };
  try {
    let listed;
    try {
      const initialized = await rpc("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: {
          name: "intelligence-system-keyword-research",
          version: "1.0.0"
        }
      });
      protocol = initialized.protocolVersion || "2025-03-26";
      await rpc("notifications/initialized", {}, true);
    } catch (error) {
      if (!/Sorftime MCP (initialize|notifications\/initialized) 返回HTTP 400/.test(
        error.message
      ))
        throw error;
      session = void 0;
      protocol = void 0;
      listed = await rpc("tools/list", {});
    }
    listed ||= await rpc("tools/list", {});
    if (productTools) return { rpc, tools: listed.tools || [] };
    const tool = Object.keys(TOOLS).map((name) => listed.tools?.find((item) => item.name === name)).find(Boolean);
    if (!tool) {
      const available = (listed.tools || []).filter(
        (item) => /keyword|related|关键词|authorization/i.test(item.name)
      ).map(
        (item) => `${item.name}(${Object.keys(item.inputSchema?.properties || {}).join(",")})`
      ).slice(0, 12).join("\uFF1B");
      throw new Error(
        `Sorftime \u8FD4\u56DE\u7684\u5173\u952E\u8BCD\u5DE5\u5177\u9700\u8981\u9002\u914D\uFF1A${available || "\u672A\u8FD4\u56DE\u5173\u952E\u8BCD\u5DE5\u5177"}`
      );
    }
    const properties = tool.inputSchema?.properties || {};
    const fields = TOOLS[tool.name];
    if (!properties[fields.market] || !properties[fields.keyword])
      throw new Error("Sorftime \u5173\u952E\u8BCD\u53C2\u6570\u5DF2\u53D8\u66F4\uFF0C\u9700\u66F4\u65B0\u63A5\u5165\u540E\u518D\u8C03\u7528");
    return { rpc, tool, fields };
  } catch (error) {
    throw new Error(
      safeError(error instanceof Error ? error.message : "", token),
      { cause: error }
    );
  }
}
async function sorftimeStatus(env, verify = false, fetcher = fetch) {
  const token = env.SORFTIME_MCP_TOKEN;
  if (!token)
    return {
      configured: false,
      ready: false,
      markets: [...MARKETS],
      message: "\u7B49\u5F85\u5728\u6570\u636E\u6E90\u4E0E\u8BBE\u7F6E\u586B\u5199 MCP Token"
    };
  if (!verify)
    return {
      configured: true,
      ready: false,
      markets: [...MARKETS],
      message: "\u5BC6\u94A5\u5DF2\u914D\u7F6E\uFF0C\u7B49\u5F85\u8FDE\u63A5\u9A8C\u8BC1"
    };
  try {
    const client = await connect(token, fetcher);
    const supported = client.tool.inputSchema.properties[client.fields.market].enum;
    return {
      configured: true,
      ready: true,
      markets: [...MARKETS],
      message: "MCP \u5DF2\u8FDE\u63A5\uFF0C\u53EF\u8C03\u7528\u5EF6\u4F38\u5173\u952E\u8BCD\u5DE5\u5177\uFF1B\u5B9E\u9645\u6570\u636E\u6309\u8D26\u6237\u989D\u5EA6\u8BA1\u8D39",
      ...Array.isArray(supported) ? {
        markets: [...MARKETS].filter(
          (market) => supported.some((value) => String(value).toUpperCase() === market)
        )
      } : {}
    };
  } catch (error) {
    return {
      configured: true,
      ready: false,
      markets: [...MARKETS],
      message: safeError(error.message, token)
    };
  }
}
function parseSorftimeKeywords(result, limit) {
  if (result.isError)
    throw new Error("Sorftime \u5DE5\u5177\u8FD4\u56DE\u9519\u8BEF\uFF0C\u8BF7\u68C0\u67E5\u5173\u952E\u8BCD\u3001\u6743\u9650\u4E0E\u5269\u4F59\u989D\u5EA6");
  const keywords = /* @__PURE__ */ new Map();
  const add = (term) => {
    const normalized = term.normalize("NFKC").replaceAll(/\s+/g, " ").trim();
    if (normalized && normalized.length <= 255)
      keywords.set(normalized.toLocaleLowerCase(), {
        term: normalized,
        source: SOURCE
      });
  };
  const visit = (value, keywordArray = false, depth = 0) => {
    if (depth > 8 || value === null || value === void 0) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          visit(JSON.parse(text), keywordArray, depth + 1);
        } catch {
        }
      } else if (keywordArray) add(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, keywordArray, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    const term = value.keyword ?? value.Keyword ?? value.searchKeyword ?? value.SearchKeyword;
    if (typeof term === "string") add(term);
    for (const key of [
      "Data",
      "data",
      "List",
      "list",
      "items",
      "Items",
      "keywords",
      "Keywords",
      "result",
      "results",
      "rows"
    ]) {
      if (value[key] !== void 0) visit(value[key], true, depth + 1);
    }
  };
  if (result.structuredContent) visit(result.structuredContent);
  for (const item of result.content || [])
    if (item.type === "text") visit(item.text);
  return [...keywords.values()].slice(0, limit);
}
async function sorftimeSuggestions(keyword, market, depth, limit, budget, env, fetcher = fetch) {
  if (!MARKETS.has(market))
    return {
      source: SOURCE,
      items: [],
      status: "unsupported",
      message: "\u5F53\u524D Sorftime \u6765\u6E90\u4E3A Amazon \u5173\u952E\u8BCD\uFF0C\u4E0D\u652F\u6301\u8D8A\u5357\u5E02\u573A\uFF0C\u672A\u8DE8\u56FD\u66FF\u4EE3"
    };
  if (budget.remaining <= 0)
    return {
      source: SOURCE,
      items: [],
      status: "error",
      message: "\u672C\u4EFB\u52A1 Sorftime \u8C03\u7528\u989D\u5EA6\u5DF2\u7528\u5B8C\uFF0C\u672A\u7EE7\u7EED\u8BF7\u6C42"
    };
  const items = /* @__PURE__ */ new Map();
  let message = "";
  try {
    const client = await connect(env.SORFTIME_MCP_TOKEN, fetcher);
    const properties = client.tool.inputSchema.properties;
    const supported = properties[client.fields.market].enum;
    const siteValue = Array.isArray(supported) ? supported.find((value) => String(value).toUpperCase() === market) : market;
    if (!siteValue)
      return {
        source: SOURCE,
        items: [],
        status: "unsupported",
        message: "\u6B64\u8D26\u6237\u7684\u5173\u952E\u8BCD\u5DE5\u5177\u4E0D\u652F\u6301\u6240\u9009\u5E02\u573A\uFF0C\u672A\u8DE8\u56FD\u66FF\u4EE3"
      };
    const query = async (term) => {
      if (budget.remaining <= 0) return;
      budget.remaining -= 1;
      budget.used += 1;
      const response = await client.rpc("tools/call", {
        name: client.tool.name,
        arguments: {
          [client.fields.market]: siteValue,
          [client.fields.keyword]: term,
          ...properties.page ? { page: properties.page.type === "string" ? "1" : 1 } : {}
        }
      });
      for (const item of parseSorftimeKeywords(response, limit + 1)) {
        const key = item.term.toLocaleLowerCase();
        if (key === keyword.normalize("NFKC").toLocaleLowerCase()) continue;
        items.set(key, item);
        if (items.size >= limit) break;
      }
    };
    await query(keyword);
    if (depth === 2) {
      for (const item of [...items.values()]) {
        if (items.size >= limit || budget.remaining <= 0) break;
        if (item.term.toLocaleLowerCase() === keyword.normalize("NFKC").toLocaleLowerCase()) continue;
        await query(item.term);
      }
    }
    if (budget.remaining <= 0 && items.size < limit)
      message = "\u5DF2\u8FBE\u5230\u672C\u4EFB\u52A1 Sorftime \u8C03\u7528\u4E0A\u9650\uFF0C\u4FDD\u7559\u5DF2\u83B7\u53D6\u5173\u952E\u8BCD";
    else if (items.size > 0 && items.size < limit)
      message = `${depth === 2 ? "\u5DF2\u5B8C\u6210\u4E8C\u7EA7\u6269\u8BCD\u5E76\u904D\u5386\u9996\u8F6E\u8FD4\u56DE\u8BCD" : "\u5DF2\u5B8C\u6210\u4E00\u7EA7\u6269\u8BCD"}\uFF1B\u672C\u6765\u6E90\u53BB\u91CD\u540E\u8FD4\u56DE${items.size}\u4E2A\u8BCD\uFF0C\u4F4E\u4E8E\u672C\u7EC4\u76EE\u6807${limit}\u4E2A\uFF0C\u672A\u7EE7\u7EED\u66F4\u6DF1\u5C42\u6269\u8BCD`;
    return {
      source: SOURCE,
      items: [...items.values()].slice(0, limit),
      status: items.size > 0 ? "success" : "empty",
      message: message || (items.size > 0 ? "Amazon \u7AD9\u5185\u5173\u952E\u8BCD\uFF0C\u4E0D\u7B49\u540C\u4E8E Google \u641C\u7D22\u91CF" : "\u672A\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u5EF6\u4F38\u8BCD\uFF0C\u8BE6\u89C1\u8FDE\u63A5\u4E0E\u8D26\u6237\u6743\u9650")
    };
  } catch (error) {
    return {
      source: SOURCE,
      items: [...items.values()].slice(0, limit),
      status: items.size > 0 ? "partial" : "error",
      message: safeError(error.message, env.SORFTIME_MCP_TOKEN)
    };
  }
}

// ../workers/site-discovery/src/index.js
var MARKET_OPTIONS = {
  US: {
    country: "us",
    language: "en",
    intent: "supplement shop buy official store",
    currency: "USD"
  },
  MX: {
    country: "mx",
    language: "es",
    intent: "suplemento comprar tienda oficial",
    currency: "MXN"
  },
  VN: {
    // Brave Web Search supports Vietnamese content, but VN is not one of its
    // country-ranking enums. Search globally and use Vietnamese intent plus
    // the location header to keep the results focused on Vietnam.
    country: "ALL",
    language: "vi",
    intent: "Vi\u1EC7t Nam th\u1EF1c ph\u1EA9m b\u1ED5 sung mua c\u1EEDa h\xE0ng ch\xEDnh h\xE3ng",
    currency: "VND"
  }
};
var GOOGLE_SUGGEST_OPTIONS = {
  US: { gl: "us", hl: "en" },
  MX: { gl: "mx", hl: "es" },
  VN: { gl: "vn", hl: "vi" }
};
var AMAZON_SUGGEST_OPTIONS = {
  US: {
    host: "completion.amazon.com",
    locale: "en_US",
    marketplace: "ATVPDKIKX0DER"
  },
  MX: {
    host: "completion.amazon.com.mx",
    locale: "es_MX",
    marketplace: "A1AM78C64UM0Y8"
  }
};
var LIVE_SOURCES = /* @__PURE__ */ new Set([
  "amazon_autocomplete",
  "google_autocomplete",
  "google_trends",
  "site_discovery",
  "sorftime"
]);
var EXCLUDED_DOMAINS = [
  "alibaba.com",
  "aliexpress.com",
  "amazon.com",
  "amazon.com.mx",
  "costco.com",
  "cvs.com",
  "ebay.com",
  "facebook.com",
  "instagram.com",
  "iherb.com",
  "kroger.com",
  "lazada.vn",
  "linkedin.com",
  "mercadolibre.com",
  "mercadolibre.com.mx",
  "pinterest.com",
  "reddit.com",
  "riteaid.com",
  "samsclub.com",
  "shopee.vn",
  "tiktok.com",
  "target.com",
  "vitacost.com",
  "walgreens.com",
  "walmart.com",
  "walmart.com.mx",
  "youtube.com"
];
var PRODUCT_EXTENSIONS = /\.(?:avi|css|docx?|gif|jpe?g|js|mp3|mp4|pdf|png|pptx?|svg|webp|xlsx?)(?:$|\?)/i;
function json(data, status = 200, origin = "") {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": origin,
      "access-control-allow-headers": "content-type,x-research-key",
      "access-control-allow-methods": "POST,OPTIONS",
      "cache-control": "no-store",
      vary: "Origin"
    }
  });
}
function allowedOrigin(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  return { allowed: allowed.includes(origin), origin };
}
function cleanText(value = "") {
  return String(value).replaceAll(/<[^>]+>/g, " ").replaceAll(/&nbsp;|&#160;/gi, " ").replaceAll(/&amp;/gi, "&").replaceAll(/&quot;|&#34;/gi, '"').replaceAll(/&#39;|&apos;/gi, "'").replaceAll(/\s+/g, " ").trim();
}
function meta(html, name) {
  const escaped = name.replaceAll(
    /[.*+?^${}()|[\]\\]/g,
    (match) => `\\${match}`
  );
  return cleanText(
    html.match(
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`,
        "i"
      )
    )?.[1] || html.match(
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`,
        "i"
      )
    )?.[1] || ""
  );
}
function findProducts(value, found = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    for (const item of value) findProducts(item, found);
    return found;
  }
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  if (types.some((type) => String(type).toLowerCase() === "product"))
    found.push(value);
  for (const child of Object.values(value)) findProducts(child, found);
  return found;
}
function extractJsonLdProducts(html) {
  const blocks = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi
  ) || [];
  const products = [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      findProducts(JSON.parse(raw), products);
    } catch {
    }
  }
  return products;
}
function firstOffer(product) {
  if (Array.isArray(product?.offers)) return product.offers[0] || {};
  return product?.offers || {};
}
function readableText(html = "") {
  return String(html).replaceAll(
    /<(?:script|style|noscript|svg)[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi,
    " "
  ).replaceAll(/<(?:br|hr)\s*\/?>/gi, "\n").replaceAll(/<\/(?:div|h[1-6]|li|p|section|tr)>/gi, "\n").replaceAll(/<[^>]+>/g, " ").replaceAll(/&nbsp;|&#160;/gi, " ").replaceAll(/&amp;/gi, "&").replaceAll(/&quot;|&#34;/gi, '"').replaceAll(/&#39;|&apos;/gi, "'").replaceAll(/[ \t]+/g, " ").replaceAll(/\s*\n\s*/g, "\n").trim();
}
function plausibleIngredients(value) {
  const text = cleanText(value);
  if (text.length < 2 || text.length > 1500) return "";
  if (/[{}]|\*\/|\/\*|=>|var\(|@media|display\s*:|position\s*:/i.test(text))
    return "";
  if (/trên cùng một trục ngang|căn chỉnh|stylesheet|javascript|cookie policy/i.test(
    text
  ))
    return "";
  if (/^(?:label directions?|directions?|supplement facts?|nutrition facts?|product details?|suggested use)$/i.test(
    text
  ))
    return "";
  const hasIngredientEvidence = /[,;；•·|]|\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|iu|cfu)\b|lactobacillus|bifidobacter|inulin|psyllium|magnesium|inositol|collagen|vitamin|zinc|omega|dha|epa/i.test(
    text
  );
  if (!hasIngredientEvidence && /\b(?:work together|supports?|promotes?|maintains?|feel your best|fast shipping|shop now|health benefits?)\b/i.test(
    text
  ))
    return "";
  if (!hasIngredientEvidence && text.split(/\s+/).length > 8) return "";
  return text;
}
function additionalProperty(product, names) {
  const wanted = names.map((item) => item.toLowerCase());
  let properties = [];
  if (Array.isArray(product?.additionalProperty))
    properties = product.additionalProperty;
  else if (product?.additionalProperty)
    properties = [product.additionalProperty];
  const match = properties.find(
    (item) => wanted.some((name) => cleanText(item?.name).toLowerCase().includes(name))
  );
  return cleanText(match?.value || match?.description || "");
}
function labeledText(text, labels) {
  const lines = String(text).split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  for (const [lineIndex, line] of lines.entries()) {
    const normalized = line.toLowerCase();
    for (const label of labels) {
      const index = normalized.indexOf(label.toLowerCase());
      if (index === -1) continue;
      const value = cleanText(
        line.slice(index + label.length).replace(/^\s*[:：\-–—]\s*/, "")
      );
      if (value.length >= 2 && value.length <= 1e3) return value;
      const nextLine = cleanText(lines[lineIndex + 1] || "");
      if (nextLine.length >= 2 && nextLine.length <= 1e3) return nextLine;
    }
  }
  return "";
}
function inferForm(value) {
  const text = String(value).toLowerCase();
  if (/capsule|capsules|cápsula|viên nang/.test(text)) return "\u80F6\u56CA";
  if (/tablet|tablets|tableta|comprimido|viên nén/.test(text)) return "\u7247\u5242";
  if (/gumm|gomita|kẹo dẻo/.test(text)) return "\u8F6F\u7CD6";
  if (/powder|polvo|bột/.test(text)) return "\u7C89\u5242";
  if (/liquid|líquido|syrup|dung dịch|nước/.test(text)) return "\u6DB2\u4F53";
  if (/softgel|soft gel/.test(text)) return "\u8F6F\u80F6\u56CA";
  return "";
}
function benefitExcerpts(description) {
  return cleanText(description).split(/(?<=[.!?。！？])\s+/).map((item) => cleanText(item)).filter((item) => item.length >= 12).map((item) => item.slice(0, 120)).slice(0, 4);
}
function inferSize(value) {
  const text = cleanText(value);
  return text.match(
    /\b\d+(?:\.\d+)?\s*(?:capsules?|tablets?|softgels?|gummies?|servings?|sachets?|sticks?|count|ct|mcg|mg|kg|g|ml|oz|lb)\b/i
  )?.[0] || "";
}
function ingredientRole(name) {
  const value = name.toLowerCase();
  const roles = [
    [
      /lactobacillus|bifidobacter|probiotic|men vi sinh/,
      "\u76CA\u751F\u83CC\u83CC\u682A\uFF1B\u5E38\u89C1\u7528\u4E8E\u80A0\u9053\u83CC\u7FA4\u76F8\u5173\u914D\u65B9"
    ],
    [/inulin|psyllium|fiber|fibre|chất xơ/, "\u81B3\u98DF\u7EA4\u7EF4\u6216\u76CA\u751F\u5143\u7C7B\u6210\u5206"],
    [/magnesium|magnesio|magiê/, "\u77FF\u7269\u8D28\u9541\u6765\u6E90\uFF1B\u5177\u4F53\u76D0\u578B\u548C\u5242\u91CF\u9700\u7ED3\u5408\u6807\u7B7E\u5224\u65AD"],
    [/inositol/, "\u808C\u9187\u7C7B\u6210\u5206\uFF1B\u5177\u4F53\u5F02\u6784\u4F53\u6BD4\u4F8B\u9700\u7ED3\u5408\u6807\u7B7E\u5224\u65AD"],
    [/collagen|colágeno/, "\u80F6\u539F\u86CB\u767D\u6216\u80F6\u539F\u80BD\u6765\u6E90"],
    [/omega|dha|epa|fish oil/, "Omega\u8102\u80AA\u9178\u6765\u6E90\uFF1B\u9700\u6838\u9A8CEPA\u3001DHA\u5177\u4F53\u542B\u91CF"],
    [/vitamin|vitamina|vitaminas/, "\u7EF4\u751F\u7D20\u7C7B\u8425\u517B\u6210\u5206\uFF1B\u9700\u6838\u9A8C\u5177\u4F53\u5F62\u5F0F\u548C\u5242\u91CF"],
    [
      /zinc|zinc oxide|zinc citrate|kẽm/,
      "\u77FF\u7269\u8D28\u950C\u6765\u6E90\uFF1B\u9700\u6838\u9A8C\u5177\u4F53\u5F62\u5F0F\u548C\u5143\u7D20\u91CF"
    ]
  ];
  return roles.find(([pattern]) => pattern.test(value))?.[1] || "\u5B98\u7F51\u914D\u65B9\u6210\u5206\uFF1B\u5177\u4F53\u4F5C\u7528\u548C\u79D1\u5B66\u8BC1\u636E\u5F85\u4EBA\u5DE5\u5BA1\u6838";
}
function ingredientRecords(ingredients, pageUrl) {
  return cleanText(ingredients).split(/[,;；•·|]/).map((item) => cleanText(item)).filter((item) => item.length >= 2 && item.length <= 120).slice(0, 12).map((item) => {
    const amount = item.match(/\b\d+(?:\.\d+)?\s*(?:mcg|mg|g|ml|iu|cfu)\b/i)?.[0] || "\u5B98\u7F51\u672A\u6807\u6CE8\u5355\u9879\u5242\u91CF";
    const name = cleanText(
      item.replace(amount, "").replaceAll(/[()（）]/g, " ")
    );
    return {
      name: name || item,
      amount,
      role: ingredientRole(name || item),
      evidence: pageUrl
    };
  });
}
function absoluteUrl(value, pageUrl) {
  if (!value) return null;
  try {
    return new URL(value, pageUrl).toString();
  } catch {
    return null;
  }
}
function imageFromHtml(html, pageUrl) {
  const metadata = meta(html, "og:image") || meta(html, "og:image:secure_url") || meta(html, "twitter:image");
  if (metadata) return absoluteUrl(metadata, pageUrl);
  const images = [...String(html).matchAll(/<img\b[^>]*>/gi)];
  const ranked = images.map(([tag]) => {
    const source = tag.match(/(?:src|data-src|data-original)=["']([^"']+)["']/i)?.[1] || tag.match(/srcset=["']([^"',\s]+)[^"']*["']/i)?.[1] || "";
    const context = tag.toLowerCase();
    let score = 0;
    if (/product|featured|main|gallery|zoom/.test(context)) score += 4;
    if (/logo|icon|avatar|flag|payment|tracking/.test(context)) score -= 5;
    if (/\.svg(?:$|\?)/i.test(source)) score -= 3;
    return { score, source: absoluteUrl(source, pageUrl) };
  }).filter((item) => item.source).toSorted((a, b) => b.score - a.score);
  return ranked[0]?.source || null;
}
function inferCategory(...values) {
  const text = values.join(" ").toLowerCase();
  const rules = [
    [
      /probiotic|prebiotic|gut|digest|inulin|psyllium|fiber|fibre|men vi sinh|đường ruột|chất xơ|probiótico|digestiv/,
      "\u80A0\u9053\u4E0E\u76CA\u751F\u83CC"
    ],
    [
      /women|woman|female|menopause|prenatal|fertility|inositol|phụ nữ|nội tiết|mujer|femenin/,
      "\u5973\u6027\u5065\u5EB7"
    ],
    [
      /collagen|skin|beauty|hair|nail|anti-aging|anti aging|làm đẹp|da tóc|belleza/,
      "\u7F8E\u5BB9\u4E0E\u6297\u8870"
    ],
    [
      /weight|slim|metabolism|fat burn|keto|giảm cân|control de peso/,
      "\u4F53\u91CD\u7BA1\u7406"
    ],
    [/sleep|stress|calm|melatonin|ashwagandha|ngủ|estrés|sueño/, "\u7761\u7720\u4E0E\u538B\u529B"],
    [/protein|creatine|bcaa|workout|sport|gym|thể thao|deport/, "\u8FD0\u52A8\u8425\u517B"],
    [
      /multivitamin|vitamin|mineral|magnesium|omega|zinc|supplement|thực phẩm bổ sung|vitamina|suplemento/,
      "\u529F\u80FD\u6027\u8425\u517B"
    ]
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || "\u5F85\u5206\u7C7B";
}
function productFromJsonLd(product, pageUrl, market, fallbackBrand, html = "") {
  const offer = firstOffer(product);
  const brand = (typeof product.brand === "string" ? product.brand : product.brand?.name) || fallbackBrand;
  let image = product.image;
  if (Array.isArray(image)) image = image[0];
  else if (typeof image === "object") image = image?.url;
  const resolvedImage = absoluteUrl(image, pageUrl) || imageFromHtml(html, pageUrl);
  const text = readableText(html || product.description || "");
  const ingredients = plausibleIngredients(product.ingredients) || plausibleIngredients(
    additionalProperty(product, [
      "ingredient",
      "ingrediente",
      "th\xE0nh ph\u1EA7n",
      "formula"
    ])
  ) || plausibleIngredients(
    labeledText(text, ["ingredients", "ingredientes", "th\xE0nh ph\u1EA7n"])
  );
  const servingSize = cleanText(
    product.servingSize || additionalProperty(product, [
      "serving size",
      "servings",
      "porci\xF3n",
      "kh\u1EA9u ph\u1EA7n"
    ]) || labeledText(text, ["serving size", "tama\xF1o de la porci\xF3n", "kh\u1EA9u ph\u1EA7n"])
  );
  const productSize = product.size;
  const size = cleanText(
    productSize || product.weight?.value || product.weight || additionalProperty(product, [
      "size",
      "count",
      "net weight",
      "contents",
      "tama\xF1o",
      "kh\u1ED1i l\u01B0\u1EE3ng"
    ]) || labeledText(text, [
      "net weight",
      "servings per container",
      "contenido neto",
      "kh\u1ED1i l\u01B0\u1EE3ng"
    ]) || inferSize(`${product.name || ""} ${product.description || ""}`)
  );
  const description = cleanText(
    product.description || meta(html, "description")
  );
  const benefits = benefitExcerpts(description);
  const ingredientInsights = ingredientRecords(ingredients, pageUrl);
  const collectionFields = [
    ["\u56FE\u7247", resolvedImage],
    ["\u89C4\u683C", size],
    ["\u5242\u578B", inferForm(`${product.name} ${size} ${description}`)],
    ["\u914D\u65B9", ingredients],
    ["\u6BCF\u4EFD\u7528\u91CF", servingSize],
    ["\u5356\u70B9", benefits.length > 0],
    ["\u6210\u5206\u5206\u6790", ingredientInsights.length > 0]
  ].filter(([, value]) => Boolean(value)).map(([label]) => label);
  return {
    title: cleanText(product.name || ""),
    brand: cleanText(brand || ""),
    description,
    sku: cleanText(product.sku || product.mpn || product.gtin || ""),
    price: offer.price === void 0 || offer.price === null ? null : Number(offer.price),
    currency: offer.priceCurrency || MARKET_OPTIONS[market].currency,
    availability: offer.availability || null,
    image: resolvedImage,
    url: product.url ? new URL(product.url, pageUrl).toString() : pageUrl,
    size,
    form: inferForm(`${product.name} ${size} ${description}`),
    ingredients,
    servingSize,
    benefits,
    ingredientInsights,
    collectionFields
  };
}
async function fetchShopifyProduct(pageUrl) {
  const page = new URL(pageUrl);
  const match = page.pathname.match(/\/products\/([^/?#]+)/i);
  if (!match) return null;
  const endpoint = new URL(`/products/${match[1]}.js`, page.origin);
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) return null;
  const data = await response.json();
  const variant = data.variants?.find((item) => item.available) || data.variants?.[0] || {};
  const rawPrice = Number(variant.price ?? data.price);
  return {
    "@type": "Product",
    name: data.title,
    brand: data.vendor,
    description: data.description,
    sku: variant.sku || variant.id || data.id,
    image: data.featured_image || data.images?.[0],
    url: pageUrl,
    offers: {
      price: Number.isFinite(rawPrice) ? rawPrice / 100 : null,
      availability: variant.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
    }
  };
}
async function fetchShopifyCatalog(pageUrl, limit) {
  const page = new URL(pageUrl);
  const endpoint = new URL("/products.json", page.origin);
  endpoint.searchParams.set("limit", String(Math.min(50, limit)));
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) return [];
  const data = await response.json();
  return (data.products || []).slice(0, limit).map((item) => {
    const variant = item.variants?.find((candidate) => candidate.available) || item.variants?.[0] || {};
    const rawPrice = Number(variant.price);
    return {
      "@type": "Product",
      name: item.title,
      brand: item.vendor,
      description: item.body_html,
      sku: variant.sku || variant.id || item.id,
      image: item.images?.[0]?.src,
      size: variant.title === "Default Title" ? "" : variant.title,
      url: new URL(`/products/${item.handle}`, page.origin).toString(),
      offers: {
        price: Number.isFinite(rawPrice) ? rawPrice : null,
        availability: variant.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock"
      }
    };
  });
}
function hostnameRoot(hostname) {
  const parts = hostname.toLowerCase().replace(/^www\./, "").split(".");
  if (parts.length <= 2) return parts.join(".");
  const secondLevel = /* @__PURE__ */ new Set(["co.nz", "co.uk", "com.au", "com.mx", "com.vn"]);
  const suffix = parts.slice(-2).join(".");
  return secondLevel.has(suffix) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}
function isCandidateUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (PRODUCT_EXTENSIONS.test(url.pathname)) return false;
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":"))
      return false;
    const root = hostnameRoot(hostname);
    return !EXCLUDED_DOMAINS.some(
      (domain) => root === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}
function classifyStore(html, pageUrl) {
  const signals = [];
  const products = extractJsonLdProducts(html);
  const hasProductSchema = products.length > 0;
  const hasCart = /(?:add[-_ ]?to[-_ ]?cart|add to bag|añadir al carrito|agregar al carrito|thêm vào giỏ)/i.test(
    html
  );
  const hasCheckout = /(?:\/checkout|checkout-button|proceed to checkout)/i.test(html);
  const hasPrice = /(?:[$€£]|USD|MXN|VND|₫)\s?\d|\d[\d.,]*\s?(?:USD|MXN|VND|₫)/i.test(html);
  const productPath = /\/(?:products?|shop|tienda|san-pham)\//i.test(
    new URL(pageUrl).pathname
  );
  let platform = "\u5176\u4ED6";
  if (/cdn\.shopify\.com|shopify-payment-button|myshopify\.com/i.test(html))
    platform = "Shopify";
  else if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(html))
    platform = "WooCommerce";
  else if (/cdn\d*\.bigcommerce\.com|bigcommerce/i.test(html))
    platform = "BigCommerce";
  else if (/static\.wixstatic\.com|wixstores/i.test(html)) platform = "Wix";
  let score = 0;
  if (hasProductSchema) {
    score += 4;
    signals.push("Product\u7ED3\u6784\u5316\u6570\u636E");
  }
  if (hasCart) {
    score += 2;
    signals.push("\u52A0\u5165\u8D2D\u7269\u8F66");
  }
  if (hasCheckout) {
    score += 2;
    signals.push("\u7ED3\u8D26\u5165\u53E3");
  }
  if (hasPrice) {
    score += 1;
    signals.push("\u4EF7\u683C");
  }
  if (productPath) {
    score += 1;
    signals.push("\u5546\u54C1\u8DEF\u5F84");
  }
  if (platform !== "\u5176\u4ED6") {
    score += 2;
    signals.push(platform);
  }
  return {
    confidence: Math.min(100, score * 10),
    isIndependentStore: score >= 5 && (hasProductSchema || hasCart || platform !== "\u5176\u4ED6"),
    platform,
    products,
    signals
  };
}
function productPageUrls(html, pageUrl, limit = 1) {
  const links = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["'][^>]*>/gi)].map(
    (match) => match[1]
  );
  const pageRoot = hostnameRoot(new URL(pageUrl).hostname);
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  for (const href of links) {
    try {
      const url = new URL(href, pageUrl);
      if (hostnameRoot(url.hostname) === pageRoot && /\/(?:products?|shop|tienda|san-pham)\//i.test(url.pathname) && isCandidateUrl(url.toString()) && !seen.has(url.toString())) {
        seen.add(url.toString());
        found.push(url.toString());
        if (found.length >= limit) break;
      }
    } catch {
    }
  }
  return found;
}
async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "ZhihengMarketResearch/0.1 (+https://leejinping8972-svg.github.io/intelligence-system/)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml"))
    throw new Error("\u975EHTML\u9875\u9762");
  const body = await response.text();
  return {
    html: body.slice(0, 8e5),
    url: response.url
  };
}
async function validateCandidate(candidate, keyword, market, productsPerSite) {
  try {
    let { html, url } = await fetchHtml(candidate);
    if (!isCandidateUrl(url)) return null;
    let classification = classifyStore(html, url);
    const landingHtml = html;
    const landingUrl = url;
    const productLinks = productPageUrls(
      html,
      url,
      Math.min(productsPerSite, 3)
    );
    const productUrl = productLinks[0];
    if (classification.products.length === 0 && productUrl && productUrl !== url) {
      try {
        const productPage = await fetchHtml(productUrl);
        const productClassification = classifyStore(
          productPage.html,
          productPage.url
        );
        if (productClassification.isIndependentStore) {
          html = productPage.html;
          url = productPage.url;
          classification = productClassification;
        }
      } catch {
      }
    }
    if (!classification.isIndependentStore) return null;
    let normalizedProducts = classification.products.map((product) => productFromJsonLd(product, url, market, "", html)).filter((product) => product.title);
    if (classification.platform === "Shopify") {
      try {
        const catalog = await fetchShopifyCatalog(landingUrl, productsPerSite);
        if (catalog.length > 0) {
          normalizedProducts = catalog.map(
            (product) => productFromJsonLd(
              product,
              product.url,
              market,
              product.brand,
              product.description
            )
          ).filter((product) => product.title);
        } else if (normalizedProducts.length === 0) {
          const shopifyProduct = await fetchShopifyProduct(url);
          if (shopifyProduct)
            normalizedProducts = [
              productFromJsonLd(
                shopifyProduct,
                url,
                market,
                shopifyProduct.brand,
                html
              )
            ];
        }
      } catch {
      }
    }
    if (classification.platform !== "Shopify" && normalizedProducts.length < productsPerSite) {
      const remainingLinks = productLinks.filter((item) => item !== url);
      const pages = await Promise.all(
        remainingLinks.map(async (item) => {
          try {
            return await fetchHtml(item);
          } catch {
            return null;
          }
        })
      );
      for (const page of pages.filter(Boolean)) {
        const pageProducts = extractJsonLdProducts(page.html).map(
          (product) => productFromJsonLd(product, page.url, market, "", page.html)
        ).filter((product) => product.title);
        normalizedProducts.push(...pageProducts);
      }
    }
    const seenProducts = /* @__PURE__ */ new Set();
    normalizedProducts = normalizedProducts.filter((product) => {
      const key = `${product.url}|${product.sku}|${product.title}`.toLowerCase();
      if (seenProducts.has(key)) return false;
      seenProducts.add(key);
      return true;
    }).slice(0, productsPerSite);
    const domain = hostnameRoot(new URL(url).hostname);
    const brand = meta(landingHtml, "og:site_name") || normalizedProducts[0]?.brand || cleanText(landingHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).split(/[|–—-]/)[0]?.trim() || domain;
    const category = inferCategory(
      keyword,
      readableText(landingHtml).slice(0, 2e4),
      ...normalizedProducts.flatMap((product) => [
        product.title,
        product.description,
        product.ingredients,
        ...product.benefits
      ])
    );
    return {
      id: `${market}-${domain}`,
      brand: cleanText(brand),
      domain,
      market,
      platform: classification.platform,
      type: "\u641C\u7D22\u53D1\u73B0\u72EC\u7ACB\u7AD9",
      keyword,
      category,
      mainProducts: normalizedProducts.map((item) => item.title).filter(Boolean).slice(0, 10),
      ownershipBackground: "\u5F85\u4ECE\u5B98\u7F51\u6838\u9A8C",
      ownershipOperations: "\u5F85\u4ECE\u5B98\u7F51\u6838\u9A8C",
      ownershipEvidence: "\u5F53\u524D\u4EC5\u786E\u8BA4\u5B98\u7F51\u5177\u6709\u72EC\u7ACB\u9500\u552E\u80FD\u529B\u3002",
      ownershipSource: url,
      collectorMode: "automatic",
      lastCollectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      evidenceUrl: url,
      confidence: classification.confidence,
      signals: classification.signals,
      products: normalizedProducts.map((product) => ({
        ...product,
        brand: product.brand || cleanText(brand)
      }))
    };
  } catch {
    return null;
  }
}
function googleSuggestUrl(keyword, market) {
  const options = GOOGLE_SUGGEST_OPTIONS[market];
  const params = new URLSearchParams({
    client: "firefox",
    gl: options.gl,
    hl: options.hl,
    q: keyword
  });
  return `https://suggestqueries.google.com/complete/search?${params}`;
}
function amazonSuggestUrl(keyword, market) {
  const options = AMAZON_SUGGEST_OPTIONS[market];
  if (!options) return null;
  const params = new URLSearchParams({
    alias: "aps",
    "client-info": "amazon-search-ui",
    event: "onkeypress",
    limit: "11",
    lop: options.locale,
    mid: options.marketplace,
    prefix: keyword,
    "response-type": "COMPLETIONS",
    "site-variant": "desktop",
    "suggestion-type": "KEYWORD",
    version: "3"
  });
  return `https://${options.host}/api/2017/suggestions?${params}`;
}
async function fetchGoogleSuggestions(keyword, market) {
  const response = await fetch(googleSuggestUrl(keyword, market), {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    },
    signal: AbortSignal.timeout(15e3)
  });
  if (!response.ok) throw new Error(`Google\u8054\u60F3\u8BCD\u8FD4\u56DEHTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.[1]) ? payload[1].map((item) => cleanText(item)).filter(Boolean) : [];
}
async function fetchAmazonSuggestions(keyword, market) {
  const url = amazonSuggestUrl(keyword, market);
  if (!url) return null;
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
    },
    signal: AbortSignal.timeout(8e3)
  });
  if (!response.ok) throw new Error(`Amazon\u8054\u60F3\u8BCD\u8FD4\u56DEHTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.suggestions) ? payload.suggestions.map((item) => cleanText(item?.value || "")).filter(Boolean) : [];
}
async function suggestionSource(source, keyword, market, depth, limit, requestBudget) {
  const label = source === "google_autocomplete" ? "Google \u8054\u60F3\u8BCD" : "Amazon \u8054\u60F3\u8BCD";
  if (source === "amazon_autocomplete" && !AMAZON_SUGGEST_OPTIONS[market]) {
    return {
      items: [],
      message: "\u8D8A\u5357\u6CA1\u6709Amazon\u672C\u5730\u7AD9\uFF0C\u672A\u6267\u884CAmazon\u8054\u60F3\u8BCD",
      source: label,
      status: "unsupported"
    };
  }
  const fetcher = source === "google_autocomplete" ? fetchGoogleSuggestions : fetchAmazonSuggestions;
  const items = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (values) => {
    for (const value of values || []) {
      const normalized = cleanText(value);
      const key = normalized.toLocaleLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      items.push({ source: label, term: normalized });
      if (items.length >= limit) break;
    }
  };
  const query = async (term) => {
    if (requestBudget.remaining <= 0) return false;
    requestBudget.remaining -= 1;
    add(await fetcher(term, market));
    return true;
  };
  try {
    await query(keyword);
    if (depth === 2 && items.length < limit) {
      const parents = items.slice(0, 5).map((item) => item.term);
      for (const parent of parents) {
        if (items.length >= limit || !await query(parent)) break;
      }
    }
    const capped = items.slice(0, limit);
    return {
      items: capped,
      message: requestBudget.remaining <= 0 && depth === 2 ? "\u5DF2\u8FBE\u5230\u514D\u8D39\u8BF7\u6C42\u4FDD\u62A4\u4E0A\u9650\uFF0C\u4FDD\u7559\u5F53\u524D\u7ED3\u679C" : "",
      source: label,
      status: capped.length > 0 ? "success" : "empty"
    };
  } catch (error) {
    return {
      items: items.slice(0, limit),
      message: error instanceof Error ? error.message : `${label}\u8BF7\u6C42\u5931\u8D25`,
      source: label,
      status: items.length > 0 ? "partial" : "error"
    };
  }
}
async function collectSuggestions(keyword, market, sources, depth, limit, requestBudget, sorftimeBudget, env) {
  const sourceResults = [];
  for (const source of sources) {
    if (source === "sorftime") {
      sourceResults.push(
        await sorftimeSuggestions(
          keyword,
          market,
          depth,
          limit,
          sorftimeBudget,
          env
        )
      );
      continue;
    }
    if (!["amazon_autocomplete", "google_autocomplete"].includes(source))
      continue;
    sourceResults.push(
      await suggestionSource(
        source,
        keyword,
        market,
        depth,
        limit,
        requestBudget
      )
    );
  }
  const items = mergeSuggestionItems(sourceResults, limit);
  return {
    items,
    keyword,
    market,
    sources: sourceResults.map(({ items: values, ...result }) => ({
      ...result,
      count: values.length
    }))
  };
}
function mergeSuggestionItems(sourceResults, limit) {
  const items = [];
  const byTerm = /* @__PURE__ */ new Map();
  const longestSource = Math.max(
    0,
    ...sourceResults.map((result) => result.items.length)
  );
  for (let index = 0; index < longestSource; index += 1) {
    for (const result of sourceResults) {
      const item = result.items[index];
      if (!item) continue;
      const key = item.term.toLocaleLowerCase();
      const existing = byTerm.get(key);
      if (existing) {
        const sources = new Set(existing.source.split(" / "));
        sources.add(item.source);
        existing.source = [...sources].join(" / ");
        continue;
      }
      const record = { ...item, category: inferCategory(item.term) };
      byTerm.set(key, record);
      items.push(record);
      if (items.length >= limit) break;
    }
    if (items.length >= limit) break;
  }
  return items;
}
function braveSearchRequest(keyword, market, count) {
  const options = MARKET_OPTIONS[market];
  const params = new URLSearchParams({
    q: `${keyword} ${options.intent}`,
    country: options.country,
    search_lang: options.language,
    count: String(Math.min(20, count)),
    safesearch: "moderate"
  });
  return {
    locationCountry: market,
    url: `https://api.search.brave.com/res/v1/web/search?${params}`
  };
}
async function braveSearch(keyword, market, env, count) {
  const request = braveSearchRequest(keyword, market, count);
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(request.url, {
      headers: {
        accept: "application/json",
        "x-subscription-token": env.BRAVE_SEARCH_API_KEY,
        "x-loc-country": request.locationCountry
      },
      signal: AbortSignal.timeout(12e3)
    });
    if (response.status !== 429 || attempt === 2) break;
    const retryAfter = Math.min(
      3e3,
      Math.max(
        1e3,
        Number(response.headers.get("retry-after")) * 1e3 || 1e3
      )
    );
    await new Promise((resolve) => setTimeout(resolve, retryAfter));
  }
  if (!response.ok) {
    if (response.status === 429)
      throw new Error("Brave Search\u514D\u8D39\u989D\u5EA6\u6216\u901F\u7387\u5DF2\u8FBE\u4E0A\u9650");
    const payload = await response.json().catch(() => null);
    const detail = cleanText(
      payload?.error?.detail || payload?.error?.message || payload?.message || ""
    );
    throw new Error(
      `Brave Search\u8FD4\u56DEHTTP ${response.status}${detail ? `\uFF1A${detail}` : ""}`
    );
  }
  const data = await response.json();
  return (data.web?.results || []).map((item) => item.url).filter((url) => isCandidateUrl(url));
}
function parseGoogleTrendsPayload(text) {
  const start = String(text).indexOf("{");
  if (start === -1) throw new Error("Google Trends\u8FD4\u56DE\u5185\u5BB9\u65E0\u6CD5\u89E3\u6790");
  return JSON.parse(String(text).slice(start));
}
function calculate28DayGrowth(series) {
  if (!Array.isArray(series) || series.length < 56) return null;
  const average = (values) => values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
  const previous = average(series.slice(-56, -28));
  if (previous <= 0) return null;
  const recent = average(series.slice(-28));
  return Math.round((recent - previous) / previous * 1e3) / 10;
}
function trendSeriesMessage(series) {
  if (!Array.isArray(series) || series.length < 56)
    return "\u6709\u6548\u65E5\u5E8F\u5217\u4E0D\u8DB356\u5929\uFF0C\u6682\u4E0D\u8BA1\u7B9728\u5929\u53D8\u5316";
  const average = (values) => values.reduce((sum, value) => sum + Number(value || 0), 0) / values.length;
  const previous = average(series.slice(-56, -28));
  const recent = average(series.slice(-28));
  if (series.every((value) => Number(value || 0) === 0))
    return "\u8FD190\u5929\u76F8\u5BF9\u70ED\u5EA6\u5747\u4E3A0\uFF0CGoogle Trends\u6837\u672C\u4E0D\u8DB3";
  if (previous <= 0 && recent > 0)
    return "\u6B64\u524D28\u5929\u5747\u503C\u4E3A0\uFF0C\u6700\u8FD128\u5929\u5DF2\u51FA\u73B0\u641C\u7D22\u4FE1\u53F7\uFF0C\u65E0\u6CD5\u8BA1\u7B97\u767E\u5206\u6BD4\u53D8\u5316";
  if (previous <= 0) return "\u6B64\u524D28\u5929\u57FA\u671F\u4E3A0\uFF0C\u65E0\u6CD5\u8BA1\u7B97\u767E\u5206\u6BD4\u53D8\u5316";
  return "";
}
function googleTrendsExploreUrl(keywords, market, period = "today 12-m") {
  const terms = (Array.isArray(keywords) ? keywords : [keywords]).filter(
    Boolean
  );
  const options = MARKET_OPTIONS[market];
  const url = new URL("https://trends.google.com/trends/api/explore");
  url.searchParams.set("hl", options.language);
  url.searchParams.set("tz", "0");
  url.searchParams.set(
    "req",
    JSON.stringify({
      category: 0,
      comparisonItem: terms.map((keyword) => ({
        geo: market,
        keyword,
        time: period
      })),
      property: ""
    })
  );
  return url.toString();
}
function googleCookieHeader(setCookie) {
  return String(setCookie || "").split(/,(?=\s*[^;,=\s]+=[^;,]+)/).map((item) => item.trim().split(";")[0]).filter(Boolean).join("; ");
}
var GOOGLE_TRENDS_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/129 Safari/537.36"
];
function googleTrendsHeaders(market, cookie = "", attempt = 0) {
  const headers = {
    accept: "application/json,text/plain,*/*",
    "accept-language": `${MARKET_OPTIONS[market].language},en;q=0.8`,
    referer: `https://trends.google.com/trends/explore?geo=${market}`,
    "user-agent": GOOGLE_TRENDS_USER_AGENTS[attempt % GOOGLE_TRENDS_USER_AGENTS.length]
  };
  if (cookie) headers.cookie = cookie;
  return headers;
}
async function googleTrendsSession(market) {
  const response = await fetch(
    `https://trends.google.com/trends/explore?geo=${market}`,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-language": `${MARKET_OPTIONS[market].language},en;q=0.8`,
        "user-agent": GOOGLE_TRENDS_USER_AGENTS[0]
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15e3)
    }
  );
  return googleCookieHeader(response.headers.get("set-cookie"));
}
async function fetchGoogleTrendsEndpoint(url, market, cookie) {
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      headers: googleTrendsHeaders(market, cookie, attempt),
      redirect: "follow",
      signal: AbortSignal.timeout(15e3)
    });
    if (response.ok) return response;
    lastStatus = response.status;
    if (response.status === 429) return response;
    if (response.status !== 429 && response.status < 500) return response;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  return new Response("", { status: lastStatus || 503 });
}
function googleTrendsHttpError(response, endpoint) {
  const error = new Error(`Google Trends${endpoint}\u63A5\u53E3\u8FD4\u56DEHTTP ${response.status}`);
  error.status = response.status;
  const retry = response.headers.get("retry-after");
  const seconds = Number(retry);
  error.retryAfterSeconds = retry ? Number.isFinite(seconds) ? Math.max(0, seconds) : Math.max(0, (Date.parse(retry) - Date.now()) / 1e3) || 0 : 0;
  return error;
}
async function fetchGoogleTrendsBatch(keywords, market, period = "today 12-m") {
  const cookie = await googleTrendsSession(market).catch(() => "");
  const exploreResponse = await fetchGoogleTrendsEndpoint(
    googleTrendsExploreUrl(keywords, market, period),
    market,
    cookie
  );
  if (!exploreResponse.ok)
    throw googleTrendsHttpError(exploreResponse, "\u63A2\u7D22");
  const explore = parseGoogleTrendsPayload(await exploreResponse.text());
  const widget = (explore.widgets || []).find(
    (item) => item.id === "TIMESERIES"
  );
  if (!widget?.token || !widget?.request)
    throw new Error("Google Trends\u672A\u8FD4\u56DE\u65F6\u95F4\u5E8F\u5217\u7EC4\u4EF6");
  const timelineUrl = new URL(
    "https://trends.google.com/trends/api/widgetdata/multiline"
  );
  timelineUrl.searchParams.set("hl", MARKET_OPTIONS[market].language);
  timelineUrl.searchParams.set("tz", "0");
  timelineUrl.searchParams.set("req", JSON.stringify(widget.request));
  timelineUrl.searchParams.set("token", widget.token);
  const timelineResponse = await fetchGoogleTrendsEndpoint(
    timelineUrl,
    market,
    cookie
  );
  if (!timelineResponse.ok)
    throw googleTrendsHttpError(timelineResponse, "\u65F6\u95F4\u5E8F\u5217");
  const timeline = parseGoogleTrendsPayload(await timelineResponse.text());
  const timelineData = timeline.default?.timelineData || [];
  return keywords.map((keyword, keywordIndex) => {
    const points = timelineData.map((item) => ({
      date: new Date(Number(item.time) * 1e3).toISOString().slice(0, 10),
      isPartial: Boolean(item.isPartial),
      value: Number(item.value?.[keywordIndex])
    })).filter((item) => Number.isFinite(item.value));
    const series = points.map((item) => item.value);
    return {
      growth: null,
      keyword,
      market,
      message: "",
      period,
      resolution: inferTrendResolution(points),
      collectedAt: (/* @__PURE__ */ new Date()).toISOString(),
      sourceUrl: trendSourceUrl(keyword, market),
      points,
      series,
      source: "Google Trends",
      status: series.some((value) => value > 0) ? "success" : "empty"
    };
  });
}
function inferTrendResolution(points) {
  if (points.length < 2) return "unknown";
  const interval = (Date.parse(points[1].date) - Date.parse(points[0].date)) / 864e5;
  if (interval <= 2) return "day";
  if (interval <= 8) return "week";
  return "month";
}
function trendSourceUrl(keyword, market) {
  const url = new URL("https://trends.google.com/trends/explore");
  url.searchParams.set("date", "today 12-m");
  url.searchParams.set("geo", market);
  url.searchParams.set("q", keyword);
  return url.toString();
}
async function collectGoogleTrendsBatch(keywords, market) {
  const results = [];
  for (const keyword of keywords) {
    let annual;
    let annualError = "";
    let rateLimited = false;
    let retryAfterSeconds = 0;
    try {
      [annual] = await fetchGoogleTrendsBatch([keyword], market);
    } catch (error) {
      annualError = error instanceof Error ? error.message : "Google Trends\u91C7\u96C6\u5931\u8D25";
      rateLimited = error?.status === 429;
      retryAfterSeconds = error?.retryAfterSeconds || 0;
    }
    if (!annual?.series.length) {
      const snapshot = trends_snapshots_default.find(
        (item) => item.keyword.toLowerCase() === keyword.toLowerCase() && item.market === market
      );
      if (snapshot) {
        annual = {
          ...snapshot,
          series: snapshot.points.map((point) => point.value),
          source: "Google Trends",
          status: "success",
          growth: null,
          message: `\u4F7F\u7528Google\u5B98\u7F51\u9875\u9762\u5B9E\u91C7\u5FEB\u7167\uFF08${snapshot.collectedAt.slice(
            0,
            10
          )}\uFF09\uFF1B\u5B9E\u65F6\u63A5\u53E3\uFF1A${annualError || "\u672A\u8FD4\u56DE\u5E8F\u5217"}`
        };
      }
    }
    if (!annual?.series.length) {
      results.push({
        growth: null,
        keyword,
        market,
        message: annualError || "Google Trends\u672A\u8FD4\u56DE\u4E00\u5E74\u65F6\u95F4\u5E8F\u5217",
        points: [],
        series: [],
        dailyPoints: [],
        period: "today 12-m",
        resolution: "unknown",
        source: "Google Trends",
        sourceUrl: trendSourceUrl(keyword, market),
        status: "error",
        rateLimited,
        retryAfterSeconds
      });
      continue;
    }
    try {
      const [daily] = await fetchGoogleTrendsBatch(
        [keyword],
        market,
        "today 3-m"
      );
      const dailyPoints = daily.resolution === "day" ? daily.points.filter((point) => !point.isPartial) : [];
      annual.dailyPoints = dailyPoints;
      const dailySeries = dailyPoints.map((point) => point.value);
      annual.growth = calculate28DayGrowth(dailySeries);
      annual.dailyMessage = trendSeriesMessage(dailySeries);
    } catch (error) {
      annual.dailyPoints = [];
      annual.growth = null;
      annual.dailyMessage = `\u4E00\u5E74\u66F2\u7EBF\u5DF2\u4FDD\u5B58\uFF1B28\u5929\u65E5\u6570\u636E\u67E5\u8BE2\u5931\u8D25\uFF1A${error instanceof Error ? error.message : "\u63A5\u53E3\u5F02\u5E38"}`;
      annual.rateLimited = error?.status === 429;
      annual.retryAfterSeconds = error?.retryAfterSeconds || 0;
    }
    results.push(annual);
  }
  return results;
}
async function enrichProduct(input) {
  try {
    const page = await fetchHtml(input.url);
    const rawProducts = extractJsonLdProducts(page.html);
    try {
      const shopifyProduct = await fetchShopifyProduct(page.url);
      if (shopifyProduct) rawProducts.unshift(shopifyProduct);
    } catch {
    }
    const candidates = rawProducts.map(
      (product2) => productFromJsonLd(
        product2,
        page.url,
        input.market,
        input.brand || "",
        page.html
      )
    ).filter((product2) => product2.title);
    const expectedTitle = cleanText(input.title || "").toLowerCase();
    const product = candidates.find((candidate) => {
      const title = candidate.title.toLowerCase();
      return expectedTitle && (title.includes(expectedTitle) || expectedTitle.includes(title));
    }) || candidates[0];
    if (!product) {
      return {
        id: input.id,
        message: "\u5546\u54C1\u9875\u672A\u8FD4\u56DE\u53EF\u8BC6\u522B\u7684\u7ED3\u6784\u5316\u5546\u54C1\u4FE1\u606F",
        status: "failed"
      };
    }
    return {
      id: input.id,
      message: `\u5DF2\u8865\u9F50${product.collectionFields.length}\u9879\u5546\u54C1\u5B57\u6BB5`,
      product,
      status: "success"
    };
  } catch (error) {
    return {
      id: input.id,
      message: error instanceof Error ? error.message : "\u5546\u54C1\u9875\u9762\u6293\u53D6\u5931\u8D25",
      status: "failed"
    };
  }
}
async function runProductEnrichment(input) {
  const products = Array.isArray(input.products) ? input.products : [];
  if (products.length === 0 || products.length > 10)
    throw new Error("\u5355\u6B21\u8BF7\u8F93\u51651\u81F310\u4EF6\u5546\u54C1");
  for (const product of products) {
    if (!product?.id || !product?.url)
      throw new Error("\u5546\u54C1\u8865\u9F50\u8BF7\u6C42\u7F3A\u5C11\u5546\u54C1ID\u6216\u5B98\u7F51\u5730\u5740");
    if (!MARKET_OPTIONS[product.market])
      throw new Error("\u5E02\u573A\u4EC5\u652F\u6301US\u3001MX\u3001VN");
    const url = new URL(product.url);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("\u5546\u54C1\u5B98\u7F51\u5730\u5740\u65E0\u6548");
  }
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    products: await Promise.all(
      products.map((product) => enrichProduct(product))
    )
  };
}
async function runResearch(input, env) {
  const keywords = [
    ...new Set(input.keywords.map((item) => item.trim()))
  ].filter(Boolean);
  const markets = [...new Set(input.markets)];
  const sources = [
    ...new Set(
      Array.isArray(input.sources) && input.sources.length > 0 ? input.sources : ["site_discovery"]
    )
  ];
  const depth = Number(input.depth) === 2 ? 2 : 1;
  const suggestionLimit = Math.max(
    1,
    Math.min(100, Number(input.limit) || 100)
  );
  const maxSites = Math.max(1, Math.min(10, Number(input.maxSites) || 6));
  const productsPerSite = Math.max(
    1,
    Math.min(20, Number(input.productsPerSite) || 10)
  );
  const candidateLimit = Math.min(20, Math.max(10, maxSites * 2));
  if (keywords.length === 0 || keywords.length > 3)
    throw new Error("\u6BCF\u6B21\u8BF7\u8F93\u51651\u81F33\u4E2A\u5173\u952E\u8BCD");
  if (markets.length === 0 || markets.some((market) => !MARKET_OPTIONS[market]))
    throw new Error("\u5E02\u573A\u4EC5\u652F\u6301US\u3001MX\u3001VN");
  if (sources.some((source) => !LIVE_SOURCES.has(source)))
    throw new Error("\u5305\u542B\u5C1A\u672A\u63A5\u5165\u7684\u771F\u5B9E\u6570\u636E\u6E90");
  if (keywords.length * markets.length > 3)
    throw new Error("\u5355\u6B21\u6700\u591A\u8FD0\u884C3\u4E2A\u201C\u5173\u952E\u8BCD \xD7 \u5E02\u573A\u201D\u7EC4\u5408\uFF0C\u8BF7\u51CF\u5C11\u5173\u952E\u8BCD\u6216\u5E02\u573A");
  const groups = [];
  const suggestions = [];
  const trends = [];
  const suggestionRequestBudget = { remaining: 20 };
  const sorftimeBudget = {
    remaining: Math.max(
      0,
      Math.min(100, Math.floor(Number(input.sorftimeRequestLimit) || 0))
    ),
    used: 0
  };
  const totalCombinations = keywords.length * markets.length;
  let processedCombinations = 0;
  let remainingSuggestions = suggestionLimit;
  if (sources.includes("google_trends")) {
    for (const market of markets)
      trends.push(...await collectGoogleTrendsBatch(keywords, market));
  }
  for (const keyword of keywords) {
    for (const market of markets) {
      if (remainingSuggestions > 0 && (sources.includes("google_autocomplete") || sources.includes("amazon_autocomplete") || sources.includes("sorftime"))) {
        const combinationsLeft = totalCombinations - processedCombinations;
        const groupLimit = Math.max(
          1,
          Math.ceil(remainingSuggestions / combinationsLeft)
        );
        const suggestionGroup = await collectSuggestions(
          keyword,
          market,
          sources,
          depth,
          groupLimit,
          suggestionRequestBudget,
          sorftimeBudget,
          env
        );
        suggestions.push(suggestionGroup);
        remainingSuggestions = Math.max(
          0,
          remainingSuggestions - suggestionGroup.items.length
        );
      }
      if (sources.includes("site_discovery")) {
        const urls = await braveSearch(keyword, market, env, 20);
        const unique = [];
        const domains = /* @__PURE__ */ new Set();
        for (const url of urls) {
          const domain = hostnameRoot(new URL(url).hostname);
          if (domains.has(domain)) continue;
          domains.add(domain);
          unique.push(url);
          if (unique.length >= candidateLimit) break;
        }
        const candidates = await Promise.all(
          unique.map(
            (url) => validateCandidate(url, keyword, market, productsPerSite)
          )
        );
        const validated = candidates.filter(Boolean).toSorted((a, b) => b.confidence - a.confidence).slice(0, maxSites);
        groups.push({
          keyword,
          market,
          coverage: {
            searchResults: urls.length,
            candidateDomains: unique.length,
            validatedSites: validated.length,
            rejectedOrUnreachable: unique.length - validated.length
          },
          sites: validated
        });
      }
      processedCombinations += 1;
    }
  }
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    usage: { sorftimeCalls: sorftimeBudget.used },
    groups,
    suggestions,
    trends
  };
}
var src_default = {
  async fetch(request, env) {
    const originState = allowedOrigin(request, env);
    const internal = Boolean(env.SERVER_BRIDGE_KEY) && request.headers.get("x-server-key") === env.SERVER_BRIDGE_KEY;
    if (request.method === "OPTIONS") {
      if (!originState.allowed)
        return json({ error: "\u6765\u6E90\u672A\u6388\u6743" }, 403, "null");
      return json({}, 204, originState.origin);
    }
    if (request.method !== "POST")
      return json(
        { error: "\u4EC5\u652F\u6301POST\u8BF7\u6C42" },
        405,
        originState.origin || "null"
      );
    if (!originState.allowed && !internal)
      return json({ error: "\u6765\u6E90\u672A\u6388\u6743" }, 403, originState.origin || "null");
    if (!env.RESEARCH_ACCESS_KEY)
      return json(
        { error: "\u7814\u7A76\u670D\u52A1\u5C1A\u672A\u5B8C\u6210\u5BC6\u94A5\u914D\u7F6E" },
        503,
        originState.origin
      );
    if (!internal && request.headers.get("x-research-key") !== env.RESEARCH_ACCESS_KEY)
      return json({ error: "\u7814\u7A76\u8BBF\u95EE\u7801\u65E0\u6548" }, 401, originState.origin);
    try {
      const input = await request.json();
      if (internal && input.action === "server_migrate_credentials") {
        const key = await crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.SERVER_BRIDGE_KEY)), "AES-GCM", false, ["encrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const credentials = { RESEARCH_ACCESS_KEY: env.RESEARCH_ACCESS_KEY, BRAVE_SEARCH_API_KEY: env.BRAVE_SEARCH_API_KEY || "", SORFTIME_MCP_TOKEN: await readSorftimeToken(env) };
        const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("intelligence-server-migration-v1") }, key, new TextEncoder().encode(JSON.stringify(credentials)));
        return json({ iv: btoa(String.fromCodePoint(...iv)), ciphertext: btoa(String.fromCodePoint(...new Uint8Array(encrypted))) }, 200, originState.origin);
      }
      if (internal && input.action !== "server_collect")
        throw new Error("\u670D\u52A1\u7AEF\u51ED\u8BC1\u4EC5\u5141\u8BB8\u5173\u952E\u8BCD\u91C7\u96C6");
      if (!internal && input.action === "server_collect")
        throw new Error("\u4EC5\u540E\u53F0\u4EFB\u52A1\u53EF\u6267\u884C\u6B64\u64CD\u4F5C");
      if (SERVER_ACTIONS.has(input.action))
        return json(await serverRelay(input, env), 200, originState.origin);
      if (input.action === "server_collect") input.action = input.sources?.includes("site_discovery") ? "site_research" : "keyword_research";
      if (input.action === "keyword_sources_config")
        return json(
          await saveSorftimeToken(input, env),
          200,
          originState.origin
        );
      if (input.action === "keyword_sources_status")
        return json(
          {
            sorftime: await sorftimeStatus(
              { ...env, SORFTIME_MCP_TOKEN: await readSorftimeToken(env) },
              input.verify === true
            )
          },
          200,
          originState.origin
        );
      if (input.action === "keyword_research") {
        const allowed = /* @__PURE__ */ new Set([
          "amazon_autocomplete",
          "google_autocomplete",
          "google_trends",
          "sorftime"
        ]);
        if (!Array.isArray(input.sources) || input.sources.length === 0 || input.sources.some((source) => !allowed.has(source)))
          throw new Error(
            "\u5173\u952E\u8BCD\u7814\u7A76\u4EC5\u5141\u8BB8\u627E\u8BCD\u4E0E\u8D8B\u52BF\u6570\u636E\u6E90\uFF0C\u4E0D\u63A5\u53D7\u7AD9\u70B9\u6216\u5546\u54C1\u91C7\u96C6"
          );
      }
      const needsSiteDiscovery = input.action !== "enrich_products" && (!input.sources?.length || input.sources.includes("site_discovery"));
      if (needsSiteDiscovery && !env.BRAVE_SEARCH_API_KEY)
        throw new Error("\u72EC\u7ACB\u7AD9\u7814\u7A76\u670D\u52A1\u5C1A\u672A\u914D\u7F6E\u641C\u7D22\u5BC6\u94A5");
      const result = input.action === "enrich_products" ? await runProductEnrichment(input) : await runResearch(
        input,
        input.sources?.includes("sorftime") ? { ...env, SORFTIME_MCP_TOKEN: await readSorftimeToken(env) } : env
      );
      return json(result, 200, originState.origin);
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : "\u7814\u7A76\u4EFB\u52A1\u6267\u884C\u5931\u8D25" },
        400,
        originState.origin
      );
    }
  }
};
export {
  calculate28DayGrowth,
  classifyStore,
  connect as connectSorftime,
  src_default as default,
  extractJsonLdProducts,
  fetchGoogleTrendsBatch,
  hostnameRoot,
  inferCategory,
  isCandidateUrl,
  productFromJsonLd,
  productPageUrls,
  readSorftimeToken,
  trendSeriesMessage
};
