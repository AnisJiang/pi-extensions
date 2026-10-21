/**
 * @enjoy4ever/pi-web-search — Unified web search and fetch for Pi Coding Agent
 *
 * Auto-selects between Grok (xAI) and AnySearch providers.
 * Config: ~/.pi/agent/extensions/pi-web-search/config.json
 *
 * Tools:
 *   web_search  — Search the web with AI-generated answers
 *   web_fetch   — Extract readable content from a URL
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
// import { Text } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

// ══════════════════════════════════════════════
//  Config
// ══════════════════════════════════════════════

interface Config {
  provider: string;
  grokApiUrl: string;
  grokApiKey: string;
  grokModel: string;
  tavilyApiUrl: string;
  tavilyApiKey: string;
  anysearchApiKey: string;
  context7ApiKey: string;
}

const CONFIG_DIR = join(homedir(), ".pi", "agent", "extensions", "pi-web-search");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const DEFAULT_CONFIG: Config = {
  provider: "auto",
  grokApiUrl: "",
  grokApiKey: "",
  grokModel: "",
  tavilyApiUrl: "",
  tavilyApiKey: "",
  anysearchApiKey: "",
  context7ApiKey: "",
};

function loadConfig(): Config {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function ensureConfig(): void {
  if (!existsSync(CONFIG_PATH)) {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n", "utf-8");
  }
}

// ══════════════════════════════════════════════
//  Shared types
// ══════════════════════════════════════════════

interface SourceItem {
  title: string;
  url: string;
  snippet?: string;
}

interface ProviderResult {
  answer: string;
  sources: SourceItem[];
  provider: string;
}

// ══════════════════════════════════════════════
//  Session manager (source caching)
// ══════════════════════════════════════════════

let _sessionCounter = 0;
const _sourceCache = new Map<string, SourceItem[]>();

function generateSessionId(): string {
  return `ws_${Date.now().toString(36)}_${(++_sessionCounter).toString(36)}`;
}

function cacheSources(sources: SourceItem[]): string {
  const id = generateSessionId();
  _sourceCache.set(id, sources);
  return id;
}

function getCachedSources(id: string): SourceItem[] | undefined {
  return _sourceCache.get(id);
}

// ══════════════════════════════════════════════
//  Bilingual helpers
// ══════════════════════════════════════════════

/** 按 " | " 拆分为多个搜索词 */
function splitQueries(query: string): string[] {
  const parts = query.split(/\s*\|\s*/).map(s => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [query];
}

/** URL 去重合并 */
function mergeResults(results: ProviderResult[]): { answer: string; sources: SourceItem[] } {
  const seen = new Set<string>();
  const allSources: SourceItem[] = [];
  const answerParts: string[] = [];

  for (const r of results) {
    if (!r) continue;
    answerParts.push(r.answer);
    for (const s of r.sources) {
      if (!seen.has(s.url)) {
        seen.add(s.url);
        allSources.push(s);
      }
    }
  }

  return {
    answer: answerParts.filter(Boolean).join("\n\n---\n\n"),
    sources: allSources,
  };
}

function formatSources(sources: SourceItem[]): string {
  if (sources.length === 0) return "";
  return `\n\n---\n\n### 来源\n${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n")}`;
}

function hasCJK(text: string): boolean {
  return /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/.test(text);
}

// ══════════════════════════════════════════════
//  HTTP helpers
// ══════════════════════════════════════════════

function httpFetch(url: string, opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = lib(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: opts.headers || {},
        timeout: opts.timeout || 30000,
        rejectUnauthorized: false,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 500)}`));
          } else {
            resolve(data);
          }
        });
      },
    );
    req.on("error", (e: Error) => reject(new Error(`Request failed: ${e.message}`)));
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// ══════════════════════════════════════════════
//  Provider: Grok (xAI) — OpenAI-compatible
// ══════════════════════════════════════════════

async function grokSearch(query: string, _maxResults: number, config: Config): Promise<ProviderResult | null> {
  const baseUrl = config.grokApiUrl || "https://api.x.ai/v1";
  const model = config.grokModel || "grok-3";
  const body = JSON.stringify({
    model,
    messages: [
      {
        role: "system",
        content: "You are a helpful AI assistant with web search capability. Search the web and provide a comprehensive, accurate answer. Cite sources with [1], [2] etc. when referencing specific facts.",
      },
      { role: "user", content: query },
    ],
    stream: false,
  });

  try {
    const result = await httpFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.grokApiKey}` },
      body,
      timeout: 120000,
    });

    const data = JSON.parse(result);
    const answer = data.choices?.[0]?.message?.content || "";

    // Extra sources via Tavily (best-effort)
    let sources: SourceItem[] = [];
    if (config.tavilyApiKey) {
      try {
        const tavilyBase = config.tavilyApiUrl || "https://api.tavily.com";
        const tr = await httpFetch(`${tavilyBase}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.tavilyApiKey}` },
          body: JSON.stringify({ query, max_results: 5, search_depth: "basic" }),
          timeout: 15000,
        });
        const tavilyData = JSON.parse(tr);
        sources = (tavilyData.results || []).map((s: any) => ({
          title: s.title || "",
          url: s.url || "",
          snippet: (s.content || "").slice(0, 200),
        }));
      } catch { /* best-effort */ }
    }

    return { answer, sources, provider: "Grok" };
  } catch {
    return null;
  }
}

async function grokFetch(url: string, config: Config): Promise<string> {
  const baseUrl = config.grokApiUrl || "https://api.x.ai/v1";
  const model = config.grokModel || "grok-3";
  try {
    const body = JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "Extract the main content from the following URL and return it as clean Markdown. Include the title, headings, key paragraphs, and any code blocks. Strip navigation, ads, and boilerplate.",
        },
        { role: "user", content: `Extract content from: ${url}` },
      ],
      stream: false,
    });

    const result = await httpFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.grokApiKey}`,
      },
      body,
      timeout: 60000,
    });

    const data = JSON.parse(result);
    return data.choices?.[0]?.message?.content || "";
  } catch {
    // Fallback: direct HTTP fetch + basic HTML stripping
    const raw = await httpFetch(url, { timeout: 30000 });
    return raw
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s{2,}/g, "\n")
      .trim()
      .slice(0, 50000);
  }
}

// ══════════════════════════════════════════════
//  Provider: AnySearch — JSON-RPC
// ══════════════════════════════════════════════

const ANYSEARCH_API_URL = "https://api.anysearch.com/mcp";

async function anysearchCall(toolName: string, args: Record<string, unknown>, config: Config): Promise<string> {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.anysearchApiKey) {
    headers["Authorization"] = `Bearer ${config.anysearchApiKey}`;
  }

  const result = await httpFetch(ANYSEARCH_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeout: 30000,
  });

  const data = JSON.parse(result);
  if (data.error) {
    throw new Error(data.error.message || JSON.stringify(data.error));
  }
  const content = data.result?.content;
  if (Array.isArray(content)) {
    const textItem = content.find((c: any) => c.type === "text");
    if (textItem) return textItem.text;
  }
  return JSON.stringify(data.result || data, null, 2);
}

async function anysearchSearch(query: string, maxResults: number, config: Config, freshness?: string, domains?: string[]): Promise<ProviderResult | null> {
  const params: any = { query, max_results: maxResults };
  if (freshness) params.constraint = { freshness };
  if (domains?.length) params.domains = domains;
  // 根据语言优化
  if (hasCJK(query)) { params.language = "zh-CN"; params.zone = "cn"; }
  else { params.language = "en"; }

  try {
    const text = await anysearchCall("search", params, config);
    // 从文本中提取 URL（Markdown 链接格式）
    const urlRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g;
    const sources: SourceItem[] = [];
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = urlRegex.exec(text)) !== null) {
      if (!seen.has(m[2])) { seen.add(m[2]); sources.push({ title: m[1], url: m[2] }); }
    }
    return { answer: text, sources, provider: "AnySearch" };
  } catch {
    return null;
  }
}

async function anysearchFetch(url: string, config: Config): Promise<string> {
  return anysearchCall("extract", { url }, config);
}

// ══════════════════════════════════════════════
//  Provider: Tavily — Real search results
// ══════════════════════════════════════════════

async function tavilySearch(query: string, freshness: string | undefined, config: Config): Promise<ProviderResult | null> {
  const apiKey = config.tavilyApiKey;
  const baseUrl = config.tavilyApiUrl || "https://api.tavily.com";
  if (!apiKey) return null;

  try {
    const body: any = { query, max_results: 5, search_depth: "basic" };
    // 映射 freshness → Tavily time_range
    if (freshness) {
      const map: Record<string, string> = { day: "1d", week: "7d", month: "30d", year: "365d" };
      body.time_range = map[freshness] || undefined;
    }

    const res = await httpFetch(`${baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      timeout: 15000,
    });

    const data = JSON.parse(res);
    if (!data.results?.length) return null;

    const answer = data.results.map((r: any, i: number) =>
      `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${(r.content || "").slice(0, 300)}`
    ).join("\n\n");

    const sources: SourceItem[] = data.results.map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: (r.content || "").slice(0, 200),
    }));

    return { answer, sources, provider: "Tavily" };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════
//  Provider: Context7 — Authoritative docs
// ══════════════════════════════════════════════

const CONTEXT7_API_URL = "https://context7.com/api";

async function context7Search(query: string, config: Config): Promise<ProviderResult | null> {
  const apiKey = config.context7ApiKey;
  if (!apiKey) return null;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "X-Context7-Source": "pi-web-search",
    };

    // Step 1: Search for matching library
    const searchUrl = `${CONTEXT7_API_URL}/v2/libs/search?${new URLSearchParams({ query, libraryName: query })}`;
    const searchRes = await httpFetch(searchUrl, { headers, timeout: 15000 });
    const searchData = JSON.parse(searchRes);

    if (!searchData.results?.length) return null;

    // Pick best match - prefer higher trustScore x benchmarkScore
    const best = searchData.results.sort((a: any, b: any) => {
      const scoreA = (a.trustScore || 5) * (a.benchmarkScore || 50);
      const scoreB = (b.trustScore || 5) * (b.benchmarkScore || 50);
      return scoreB - scoreA;
    })[0];

    if (!best?.id) return null;

    // Step 2: Fetch documentation (returns plain text Markdown, not JSON)
    const docUrl = `${CONTEXT7_API_URL}/v2/context?${new URLSearchParams({ query, libraryId: best.id })}`;
    const docText = await httpFetch(docUrl, { headers, timeout: 30000 });

    if (!docText || docText.length < 10) return null;

    return {
      answer: `## 📖 ${best.title} — 官方文档\n\n${docText}`,
      sources: [{ title: `${best.title} 官方文档`, url: (best.url || best.documentationUrl || `https://context7.com/libs/${best.id}`) }],
      provider: "Context7",
    };
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════════
//  Programming query detection
// ══════════════════════════════════════════════

const LIBRARY_KEYWORDS = [
  // Popular frameworks & libraries
  /\b(React|Next\.js|Vue\.?js|Angular|Svelte|Solid\.?js|Nuxt|SvelteKit|Remix|Gatsby)\b/i,
  /\b(Express|Fastify|NestJS|Koa|Hono|Hapi|LoopBack|Adonis)\b/i,
  /\b(Django|Flask|FastAPI|Spring|Laravel|Rails|Phoenix|ASP\.NET)\b/i,
  /\b(TensorFlow|PyTorch|Keras|Scikit-learn|Pandas|NumPy|OpenCV|Hugging\s*Face)\b/i,
  /\b(Prisma|TypeORM|Drizzle|Mongoose|Sequelize|Knex|SQLAlchemy)\b/i,
  /\b(Python|JavaScript|TypeScript|Rust|Go|Java|Swift|Kotlin|C\+\+|Ruby|PHP|Elixir)\b/i,
  /\b(React\s*Native|Flutter|SwiftUI|Jetpack\s*Compose|Tauri|Electron)\b/i,
  /\b(NextAuth|Clerk|Supabase|Firebase|Auth0|AWS\s*Amplify)\b/i,
  /\b(Tailwind|Bootstrap|Chakra|MUI|Shadcn|Radix|Styled\s*Components)\b/i,
  // Programming action patterns
  /\b(how\s+to\s+(use|install|setup|configure|implement|customize|build|create|deploy))\b/i,
  /\b(API\s*(reference|docs?|documentation)|SDK|CLI)\b/i,
  /\b(npm\s+(install|run|publish|add|build)|pip\s+(install|freeze)|yarn\s+(add|install))\b/i,
];

function isProgrammingQuery(query: string): boolean {
  return LIBRARY_KEYWORDS.some((p) => p.test(query));
}

// ══════════════════════════════════════════════
//  Helpers
// ══════════════════════════════════════════════

// ══════════════════════════════════════════════
//  Provider resolution
// ══════════════════════════════════════════════

type Provider = "grok" | "anysearch" | "context7" | "tavily";

function resolveChain(config: Config, preferred?: string, query?: string): Provider[] {
  const choice = preferred || config.provider || "auto";

  if (choice === "context7") return ["context7"];
  if (choice === "grok") return ["grok"];
  if (choice === "tavily") return ["tavily"];
  if (choice === "anysearch") return ["anysearch"];

  // auto: build chain
  const chain: Provider[] = [];

  // Context7 only for programming queries (authoritative docs)
  if (config.context7ApiKey && query && isProgrammingQuery(query)) {
    chain.push("context7");
  }

  // Grok (with Tavily assist for sources)
  if (config.grokApiKey) chain.push("grok");

  // Tavily + AnySearch as fallback pair
  if (config.tavilyApiKey) chain.push("tavily");
  if (config.anysearchApiKey) chain.push("anysearch");

  return chain.length > 0 ? chain : ["grok"];
}

// ══════════════════════════════════════════════
//  Extension entry point
// ══════════════════════════════════════════════



export default function (pi: ExtensionAPI) {
  // Ensure config file exists on load
  ensureConfig();

  // ─── Tool: web_search ───
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web and get answers with source citations. " +
      "Auto bilingual: separate languages with \" | \" in query (e.g. \"量子计算 | quantum computing\"). " +
      "Supports Grok (xAI), Context7 (authoritative docs), AnySearch, and Tavily providers.",
    promptSnippet: "Search the web for real-time information.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query. Use \"query1 | query2\" for bilingual search." }),
      max_results: Type.Optional(Type.Number({ description: "Number of results (default: 5, max: 20)" })),
      provider: Type.Optional(Type.String({ description: 'Force provider: "context7", "grok", "tavily", "anysearch", or "auto" (default)' })),
      freshness: Type.Optional(Type.String({ description: 'Time range: "day", "week", "month", "year"' })),
      domains: Type.Optional(Type.Array(Type.String(), { description: 'Content domains filter, e.g. ["tech", "academic", "news"]' })),
      sources: Type.Optional(Type.Boolean({ description: "Include source list in output (default: true). Set false to only get answer + session_id." })),
    }),
    promptGuidelines: [
      "- Use web_search first when the user asks about current events, recent information, or anything outside your training data.",
      "- For multilingual queries, separate languages with \" | \" in the query parameter, e.g. \"量子计算 | quantum computing\".",
      "- Use freshness to filter by recency: \"day\", \"week\", \"month\", \"year\".",
      "- Use domains to narrow results: [\"tech\", \"academic\", \"news\", \"code\"].",
      "- Set sources=false to save tokens — only the answer summary is returned; call get_sources(sessionId) later if sources are needed.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const config = loadConfig();
      const maxResults = Math.min(params.max_results ?? 5, 20);
      const freshness = params.freshness as string | undefined;
      const domains = params.domains as string[] | undefined;
      const includeSources = params.sources !== false;

      // 拆分双语查询
      const queries = splitQueries(params.query);

      // 对每个子搜索运行 provider 链
      async function searchOne(q: string): Promise<ProviderResult | null> {
        const chain = resolveChain(config, params.provider, q);
        for (const p of chain) {
          if ((p === "grok" && !config.grokApiKey) ||
              (p === "anysearch" && !config.anysearchApiKey) ||
              (p === "context7" && !config.context7ApiKey) ||
              (p === "tavily" && !config.tavilyApiKey)) continue;
          try {
            let res: ProviderResult | null = null;
            if (p === "context7") res = await context7Search(q, config);
            else if (p === "grok") res = await grokSearch(q, maxResults, config);
            else if (p === "tavily") res = await tavilySearch(q, freshness, config);
            else res = await anysearchSearch(q, maxResults, config, freshness, domains);
            if (res) return res;
          } catch { /* try next */ }
        }
        return null;
      }

      // 并行搜索所有子查询
      const results = (await Promise.all(queries.map(q => searchOne(q)))).filter(Boolean) as ProviderResult[];

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "All search providers failed. Check your API keys in the config file." }],
          details: { error: "All providers failed" },
        };
      }

      // 合并结果，URL 去重
      const merged = mergeResults(results);

      // 来源缓存模式
      if (!includeSources) {
        const sessionId = cacheSources(merged.sources);
        return {
          content: [{ type: "text" as const, text: merged.answer }],
          details: { provider: "merged", sessionId, queries },
        };
      }

      return {
        content: [{ type: "text" as const, text: merged.answer + formatSources(merged.sources) }],
        details: { provider: "merged", queries },
      };
    },

    // renderCall(args, theme, context) {
    //   const q = (args as any)?.query || "";
    //   if (context?.expanded === false) {
    //     const display = q.length > 45 ? q.slice(0, 42) + "..." : q;
    //     return new Text(theme.fg("toolTitle", theme.bold("web_search ")) + theme.fg("accent", display), 0, 0);
    //   }
    //   const display = q.length > 50 ? q.slice(0, 47) + "..." : q;
    //   return new Text(theme.fg("toolTitle", theme.bold("web_search ")) + theme.fg("accent", display), 0, 0);
    // },

    // renderResult(result, { expanded }, theme, _context) {
    //   if (!expanded) return new Text("", 0, 0);
    //   const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    //   return new Text(text, 0, 0);
    // },
  });

  // ─── Tool: web_fetch ───
  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch a URL and extract readable content as Markdown. " +
      "Uses AnySearch extract (if available) or falls back to AI-powered extraction via Grok. " +
      "Configure API keys in ~/.pi/agent/extensions/pi-web-search/config.json.",
    promptSnippet: "Fetch and extract readable content from a URL.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch and extract content from" }),
    }),
    promptGuidelines: [
      "- Use web_fetch to get full page content from a URL, useful after web_search returns interesting links.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const config = loadConfig();
      const url = params.url;

      try {
        // Prefer anysearch extract (cleaner output), fall back to grok
        let result: string;
        if (config.anysearchApiKey) {
          result = await anysearchFetch(url, config);
        } else if (config.grokApiKey) {
          result = await grokFetch(url, config);
        } else {
          // Direct HTTP fetch as last resort
          const raw = await httpFetch(url, { timeout: 30000 });
          result = raw
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s{2,}/g, "\n")
            .trim()
            .slice(0, 50000);
        }

        return {
          content: [{ type: "text", text: result }],
          details: { url, contentLength: result.length },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Fetch error: ${err.message}` }],
          details: { error: err.message, url },
        };
      }
    },

    // renderResult(result, { expanded }, theme, _context) {
    //   // 折叠时完全隐藏
    //   if (!expanded) return new Text("", 0, 0);

    //   const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    //   return new Text(text, 0, 0);
    // },
  });

  // ─── Tool: get_sources (来源缓存取回) ───
  pi.registerTool({
    name: "get_sources",
    label: "Get Sources",
    description: "Retrieve full source list for a previous web_search session. Use when web_search was called with sources=false.",
    promptSnippet: "Get the source list for a previous search.",
    parameters: Type.Object({
      session_id: Type.String({ description: "The sessionId returned by web_search when sources=false." }),
    }),
    promptGuidelines: [
      "- Call this after web_search returned a sessionId if you need to cite specific sources.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const sources = getCachedSources(params.session_id);
      if (!sources) {
        return {
          content: [{ type: "text" as const, text: "Session not found or expired." }],
          details: { error: "Session not found", session_id: params.session_id },
        };
      }

      const answer = sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join("\n");
      return {
        content: [{ type: "text" as const, text: `### 来源列表\n\n${answer}` }],
        details: { session_id: params.session_id, sourceCount: sources.length },
      };
    },

    // renderCall(args, theme, context) {
    //   const sid = (args as any)?.session_id || "";
    //   const display = sid.length > 30 ? sid.slice(0, 27) + "..." : sid;
    //   return new Text(theme.fg("toolTitle", theme.bold("get_sources ")) + theme.fg("accent", display), 0, 0);
    // },

    // renderResult(result, { expanded }, theme, _context) {
    //   if (!expanded) return new Text("", 0, 0);
    //   const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    //   return new Text(text, 0, 0);
    // },
  });

  // ─── Tool: search_planning (复杂查询分解) ───
  pi.registerTool({
    name: "search_planning",
    label: "Search Planning",
    description: "For complex or multi-faceted queries: decomposes the question into sub-searches, runs them all in parallel, and returns a comprehensive answer with merged sources.",
    promptSnippet: "Perform a structured multi-query search for complex questions.",
    parameters: Type.Object({
      goal: Type.String({ description: "The complex question or research goal." }),
      sub_queries: Type.Optional(Type.Number({ description: "Number of sub-queries to generate (default: 3, max: 6)" })),
      freshness: Type.Optional(Type.String({ description: 'Time range: "day", "week", "month", "year"' })),
      sources: Type.Optional(Type.Boolean({ description: "Include source list (default: true)" })),
    }),
    promptGuidelines: [
      "- Use search_planning when the user asks a complex or multi-faceted question that would benefit from multiple targeted searches.",
      "- Examples: compare frameworks, research a topic from multiple angles, gather comprehensive information.",
      "- The tool handles decomposition and merging automatically.",
    ],

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const config = loadConfig();
      const freshness = params.freshness as string | undefined;
      const includeSources = params.sources !== false;

      // 用 Grok 分解目标为子搜索词
      if (!config.grokApiKey) {
        // 没有 Grok 则降级为普通 web_search
        return {
          content: [{ type: "text" as const, text: "search_planning requires a Grok API key for query decomposition. Falling back to web_search." }],
          details: { error: "No Grok API key" },
        };
      }

      try {
        const baseUrl = config.grokApiUrl || "https://api.x.ai/v1";
        const model = config.grokModel || "grok-3";
        const subCount = Math.min(params.sub_queries ?? 3, 6);

        const planResult = await httpFetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.grokApiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: "system",
                content: `You are a search strategy expert. Decompose the user's research goal into ${subCount} specific, targeted search queries that together cover all aspects. Return a JSON array of strings only, no other text. Example: ["query 1", "query 2", "query 3"]`,
              },
              { role: "user", content: params.goal },
            ],
            max_tokens: 500,
            stream: false,
          }),
          timeout: 30000,
        });

        const planData = JSON.parse(planResult);
        const planText = planData.choices?.[0]?.message?.content || "[]";
        const subQueries: string[] = JSON.parse(planText);

        if (!Array.isArray(subQueries) || subQueries.length === 0) {
          throw new Error("Failed to decompose query");
        }

        // 并行搜索所有子查询
        const results: ProviderResult[] = [];
        const searchPromises = subQueries.map(async (q) => {
          const chain = resolveChain(config, undefined, q);
          for (const p of chain) {
            if ((p === "grok" && !config.grokApiKey) ||
                (p === "anysearch" && !config.anysearchApiKey) ||
                (p === "tavily" && !config.tavilyApiKey)) continue;
            try {
              let res: ProviderResult | null = null;
              if (p === "context7") res = await context7Search(q, config);
              else if (p === "grok") res = await grokSearch(q, 5, config);
              else if (p === "tavily") res = await tavilySearch(q, freshness, config);
              else res = await anysearchSearch(q, 5, config, freshness);
              if (res) { results.push(res); return; }
            } catch { /* try next */ }
          }
        });

        await Promise.all(searchPromises);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "All sub-searches failed. Check your API keys." }],
            details: { error: "All searches failed" },
          };
        }

        // 合并去重
        const merged = mergeResults(results);
        const header = `## 🧠 综合搜索结果\n\n目标：${params.goal}\n\n---\n`;

        if (!includeSources) {
          const sessionId = cacheSources(merged.sources);
          return {
            content: [{ type: "text" as const, text: header + merged.answer }],
            details: { provider: "search_planning", sessionId, subQueries },
          };
        }

        return {
          content: [{ type: "text" as const, text: header + merged.answer + formatSources(merged.sources) }],
          details: { provider: "search_planning", subQueries },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Search planning failed: ${err.message}` }],
          details: { error: err.message },
        };
      }
    },

    // renderCall(args, theme, context) {
    //   const goal = (args as any)?.goal || "";
    //   if (context?.expanded === false) {
    //     const display = goal.length > 40 ? goal.slice(0, 37) + "..." : goal;
    //     return new Text(theme.fg("toolTitle", theme.bold("search_planning ")) + theme.fg("accent", display), 0, 0);
    //   }
    //   const display = goal.length > 50 ? goal.slice(0, 47) + "..." : goal;
    //   return new Text(theme.fg("toolTitle", theme.bold("search_planning ")) + theme.fg("accent", display), 0, 0);
    // },

    // renderResult(result, { expanded }, theme, _context) {
    //   if (!expanded) return new Text("", 0, 0);
    //   const text = result.content?.[0]?.type === "text" ? result.content[0].text : "";
    //   return new Text(text, 0, 0);
    // },
  });
}
