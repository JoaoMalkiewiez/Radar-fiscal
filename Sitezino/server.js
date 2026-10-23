"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5500;
const HOST = process.env.HOST || "0.0.0.0";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const PUBLIC_URL = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");

const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const IE_API = "https://publica.cnpj.ws/cnpj/";
const MONITOR_ORIGIN = "https://monitor.tecnospeed.com.br";
const DOCUMENTS = ["nfe", "nfce", "cte"];

const MONITOR_TTL = 60 * 1000;
const MONITOR_HISTORY_URL = "https://raw.githubusercontent.com/JoaoMalkiewiez/Radar-fiscal/monitor-history/history.json";
const MONITOR_HISTORY_TTL = 60 * 1000;
const CNPJ_TTL = 10 * 60 * 1000;
const CNPJ_PARTIAL_TTL = 2 * 60 * 1000;
const CNPJ_STALE_TTL = 24 * 60 * 60 * 1000;
const CNPJ_FORCE_INTERVAL = 15 * 1000;
const CNPJ_CACHE_MAX = 200;
const UPSTREAM_TIMEOUT = 6500;
const RATE_WINDOW = 60 * 1000;
const RATE_LIMITS = {
  monitor: 120,
  cnpj: 30,
};

const STATIC_FILES = {
  "/index.html": "text/html; charset=utf-8",
  "/privacidade.html": "text/html; charset=utf-8",
  "/styles.css": "text/css; charset=utf-8",
  "/app.js": "text/javascript; charset=utf-8",
  "/ads.txt": "text/plain; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com",
  "connect-src 'self' https://brasilapi.com.br https://publica.cnpj.ws https://fonts.googleapis.com https://fonts.gstatic.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com",
  "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "manifest-src 'self'",
].join("; ");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": CSP,
};

let monitorCache = { data: null, at: 0 };
let monitorHistoryCache = { data: null, at: 0 };
let monitorInflight = null;
const cnpjCache = new Map();
const cnpjInflight = new Map();
const rateBuckets = new Map();
const compressionCache = new Map();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.start >= RATE_WINDOW) rateBuckets.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

function clientIP(request) {
  if (TRUST_PROXY) {
    const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket.remoteAddress || "unknown";
}

function checkRateLimit(request, response, scope, limit) {
  const key = `${scope}:${clientIP(request)}`;
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start >= RATE_WINDOW) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;

  if (bucket.count <= limit) return true;

  const retryAfter = Math.max(1, Math.ceil((RATE_WINDOW - (now - bucket.start)) / 1000));
  sendJSON(request, response, 429, {
    error: "Muitas requisições em pouco tempo. Aguarde um instante e tente novamente.",
    retryAfter,
  }, { "Retry-After": String(retryAfter) });
  return false;
}

function acceptsGzip(request) {
  return /\bgzip\b/i.test(String(request.headers["accept-encoding"] || ""));
}

function gzipBody(buffer, cacheKey) {
  if (cacheKey && compressionCache.has(cacheKey)) return compressionCache.get(cacheKey);
  const compressed = zlib.gzipSync(buffer, { level: 6 });
  if (cacheKey) {
    compressionCache.set(cacheKey, compressed);
    if (compressionCache.size > 40) {
      compressionCache.delete(compressionCache.keys().next().value);
    }
  }
  return compressed;
}

function sendBuffer(request, response, statusCode, body, headers = {}, cacheKey = "") {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), "utf8");
  const outgoing = { ...SECURITY_HEADERS, ...headers };
  const contentType = String(outgoing["Content-Type"] || "");
  let payload = buffer;

  if (acceptsGzip(request) && buffer.length >= 700 && /^(text\/|application\/(json|xml)|image\/svg\+xml)/i.test(contentType)) {
    payload = gzipBody(buffer, cacheKey);
    outgoing["Content-Encoding"] = "gzip";
    outgoing["Vary"] = "Accept-Encoding";
  }

  outgoing["Content-Length"] = payload.length;
  response.writeHead(statusCode, outgoing);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(payload);
}

function sendJSON(request, response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  sendBuffer(request, response, statusCode, body, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    ...extraHeaders,
  });
}

function sendText(request, response, statusCode, body, extraHeaders = {}) {
  sendBuffer(request, response, statusCode, body, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    ...extraHeaders,
  });
}

function upstreamGet(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "User-Agent": "RadarFiscal/1.1 (consulta publica)",
      },
      timeout: UPSTREAM_TIMEOUT,
    }, (response) => {
      const status = response.statusCode || 0;
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4_000_000) {
          const error = new Error("Resposta muito grande da fonte pública");
          error.status = 502;
          request.destroy(error);
        }
      });
      response.on("end", () => {
        if (status >= 200 && status < 300) {
          try {
            resolve(JSON.parse(body));
          } catch {
            const error = new Error("Resposta inválida da fonte pública");
            error.status = 502;
            reject(error);
          }
          return;
        }
        const error = new Error(`Fonte pública respondeu HTTP ${status}`);
        error.status = status;
        error.upstreamBody = body.slice(0, 240);
        reject(error);
      });
    });

    request.on("timeout", () => {
      const error = new Error("Tempo esgotado ao consultar a fonte pública");
      error.status = 0;
      error.kind = "timeout";
      request.destroy(error);
    });

    request.on("error", (error) => {
      if (!error.status) {
        error.status = 0;
        error.kind = error.kind || "network";
      }
      reject(error);
    });
  });
}

async function fetchWithRetry(url, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await upstreamGet(url);
    } catch (error) {
      lastError = error;
      const status = Number(error.status) || 0;
      const retryable = status === 0 || status >= 500;
      if (!retryable || attempt === attempts - 1) break;
      await delay(600 * (attempt + 1));
    }
  }
  throw lastError;
}

function errorInfo(error) {
  const status = Number(error?.status) || 0;
  let kind = "unavailable";
  if (status === 404) kind = "not-found";
  else if (status === 429) kind = "rate-limit";
  else if (!status) kind = error?.kind || "network";
  return {
    status,
    kind,
    message: error?.message || "Falha ao consultar a fonte pública",
  };
}

function readCnpjCache(cnpj) {
  const entry = cnpjCache.get(cnpj);
  if (!entry) return null;
  if (Date.now() - entry.at > CNPJ_STALE_TTL) {
    cnpjCache.delete(cnpj);
    return null;
  }
  return entry;
}

function writeCnpjCache(cnpj, data) {
  const ttl = data.brasil && data.ie ? CNPJ_TTL : CNPJ_PARTIAL_TTL;
  cnpjCache.delete(cnpj);
  cnpjCache.set(cnpj, { data, at: Date.now(), ttl });
  while (cnpjCache.size > CNPJ_CACHE_MAX) {
    cnpjCache.delete(cnpjCache.keys().next().value);
  }
}

async function buildCompanyData(cnpj) {
  const [brasilResult, ieResult] = await Promise.allSettled([
    fetchWithRetry(BRASIL_API + cnpj),
    fetchWithRetry(IE_API + cnpj),
  ]);

  const data = {
    cnpj,
    brasil: brasilResult.status === "fulfilled" ? brasilResult.value : null,
    ie: ieResult.status === "fulfilled" ? ieResult.value : null,
    brasilError: brasilResult.status === "rejected" ? errorInfo(brasilResult.reason) : null,
    ieError: ieResult.status === "rejected" ? errorInfo(ieResult.reason) : null,
    fetchedAt: new Date().toISOString(),
    warnings: [],
  };

  if (data.brasil || data.ie) writeCnpjCache(cnpj, data);
  return data;
}

async function getCompanyData(cnpj, force = false) {
  const cached = readCnpjCache(cnpj);
  const cacheAge = cached ? Date.now() - cached.at : Infinity;
  const fresh = cached && cacheAge < (cached.ttl || CNPJ_TTL);

  if (fresh && (!force || cacheAge < CNPJ_FORCE_INTERVAL)) {
    return { ...cached.data, cached: true, stale: false };
  }

  if (cnpjInflight.has(cnpj)) return cnpjInflight.get(cnpj);

  const pending = buildCompanyData(cnpj)
    .then((fresh) => {
      let data = fresh;
      if (cached) {
        const warnings = [];
        if (!fresh.brasil && cached.data.brasil) {
          data = { ...data, brasil: cached.data.brasil };
          warnings.push("Cadastro recuperado do cache do servidor.");
        }
        if (!fresh.ie && cached.data.ie) {
          data = { ...data, ie: cached.data.ie };
          warnings.push("Inscrições estaduais recuperadas do cache do servidor.");
        }
        if (warnings.length) data = { ...data, stale: true, warnings: [...data.warnings, ...warnings] };
      }
      return { ...data, cached: false, stale: Boolean(data.stale) };
    })
    .finally(() => cnpjInflight.delete(cnpj));

  cnpjInflight.set(cnpj, pending);
  return pending;
}


async function getMonitorHistory(force = false) {
  if (!force && monitorHistoryCache.data && Date.now() - monitorHistoryCache.at < MONITOR_HISTORY_TTL) {
    return { ...monitorHistoryCache.data, cached: true };
  }

  try {
    const cacheVersion = Math.floor(Date.now() / MONITOR_HISTORY_TTL);
    const response = await fetch(`${MONITOR_HISTORY_URL}?v=${cacheVersion}`, {
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw new Error(`Fonte do histórico respondeu HTTP ${response.status}`);

    const payload = await response.json();
    if (!payload || !Array.isArray(payload.incidents)) {
      throw new Error("Formato inválido do histórico SEFAZ");
    }

    const safeData = {
      schemaVersion: 1,
      trackingSince: typeof payload.trackingSince === "string" ? payload.trackingSince : null,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      incidents: payload.incidents
        .filter((item) => item && typeof item === "object")
        .slice(-300),
    };
    monitorHistoryCache = { data: safeData, at: Date.now() };
    return { ...safeData, cached: false };
  } catch (error) {
    if (monitorHistoryCache.data) {
      return {
        ...monitorHistoryCache.data,
        cached: true,
        stale: true,
        warning: error.message,
      };
    }
    throw error;
  }
}

const MONITOR_UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

function parseMonitorStates(payload, doc) {
  if (!Array.isArray(payload)) throw new Error(`Formato inesperado para ${doc}`);

  const states = {};
  for (const item of payload) {
    if (!item || typeof item !== "object") continue;

    // A API não documenta publicamente um único campo para o identificador.
    // Aceita os nomes usados pelo worker em snake_case/camelCase ou no próprio id.
    const identifiers = [
      item.id_worker,
      item.worker_id,
      item.workerId,
      item.id,
      item.slug,
      item.name,
    ].map((value) => String(value ?? "").trim().toLowerCase());

    let match = null;
    for (const identifier of identifiers) {
      const candidate = /sefaz_(nfe|nfce|cte)_envio_([a-z]{2})(?:$|[^a-z])/i.exec(identifier);
      if (candidate && candidate[1].toLowerCase() === doc.toLowerCase()) {
        match = candidate;
        break;
      }
    }

    // Alguns retornos podem expor a UF em campo próprio em vez do sufixo do worker.
    // Como a requisição já é filtrada por doc, esse fallback serve para esses registros.
    const explicitUf = item.uf ?? item.uf_sigla ?? item.state_uf ?? item.sigla_uf;
    const uf = String(match ? match[2] : explicitUf ?? "").trim().toUpperCase();
    if (!MONITOR_UFS.has(uf)) continue;

    const itemDoc = String(item.doc ?? item.document ?? item.documento ?? "").trim().toLowerCase();
    if (!match && itemDoc && itemDoc !== doc.toLowerCase()) continue;

    const rawStatus = item.status ?? item.status_code ?? item.stateStatus ?? item.state_status;
    const value = Number.parseInt(rawStatus, 10);
    states[uf] = Number.isFinite(value) ? value : 0;
  }

  return states;
}

async function fetchMonitorDocument(doc) {
  // O worker de SP é a referência usada pela API para retornar o quadro estadual
  // do documento selecionado; a resposta pode listar registros com identificadores variados.
  const url = `${MONITOR_ORIGIN}/monitores?stateStatus=true&doc=${encodeURIComponent(doc)}&worker_id=sefaz_${doc}_envio_sp`;
  const payload = await fetchWithRetry(url, 2);
  const states = parseMonitorStates(payload, doc);
  if (Object.keys(states).length === 0) {
    throw new Error(`A fonte não retornou status estaduais reconhecíveis para ${doc.toUpperCase()}`);
  }
  return states;
}

async function buildMonitorData() {
  const settled = await Promise.allSettled(DOCUMENTS.map((doc) => fetchMonitorDocument(doc)));
  const docs = {};
  const errors = {};
  let successes = 0;

  settled.forEach((result, index) => {
    const doc = DOCUMENTS[index];
    if (result.status === "fulfilled") {
      docs[doc] = result.value;
      successes += 1;
    } else {
      docs[doc] = {};
      errors[doc] = result.reason?.message || "Falha ao consultar";
    }
  });

  if (!successes) throw new Error("Nenhum documento pôde ser consultado");

  return {
    updatedAt: new Date().toISOString(),
    source: "Monitor SEFAZ · TecnoSpeed",
    sourceURL: "https://monitor.tecnospeed.com.br/",
    docs,
    errors,
  };
}

async function getMonitorData(force = false) {
  if (!force && monitorCache.data && Date.now() - monitorCache.at < MONITOR_TTL) {
    return { ...monitorCache.data, cached: true };
  }
  if (force && monitorCache.data && Date.now() - monitorCache.at < 10_000) {
    return { ...monitorCache.data, cached: true };
  }
  if (monitorInflight) return monitorInflight;

  monitorInflight = buildMonitorData()
    .then((data) => {
      monitorCache = { data, at: Date.now() };
      return { ...data, cached: false };
    })
    .catch((error) => {
      if (monitorCache.data) {
        return { ...monitorCache.data, stale: true, warning: error.message };
      }
      throw error;
    })
    .finally(() => {
      monitorInflight = null;
    });

  return monitorInflight;
}

function siteOrigin(request) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const forwardedProto = TRUST_PROXY
    ? String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    : "";
  const protocol = forwardedProto === "https" || request.socket.encrypted ? "https" : "http";
  const rawHost = String(request.headers.host || "localhost");
  const host = /^[a-z0-9.:-]+$/i.test(rawHost) ? rawHost : "localhost";
  return `${protocol}://${host}`;
}

function serveStatic(request, response, pathname) {
  const contentType = STATIC_FILES[pathname];
  if (!contentType) {
    sendText(request, response, 404, "Not found");
    return;
  }

  const filePath = path.join(ROOT, pathname);
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      sendText(request, response, 404, "Not found");
      return;
    }

    fs.readFile(filePath, (readError, buffer) => {
      if (readError) {
        sendText(request, response, 500, "Erro ao ler o arquivo");
        return;
      }
      const cacheKey = `${filePath}:${stats.mtimeMs}:${stats.size}`;
      sendBuffer(request, response, 200, buffer, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "Last-Modified": stats.mtime.toUTCString(),
      }, cacheKey);
    });
  });
}

async function handleRequest(request, response) {
  let pathname = "/";
  let url;
  try {
    url = new URL(request.url, "http://localhost");
    pathname = decodeURIComponent(url.pathname);
  } catch {
    sendText(request, response, 400, "Bad request");
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendJSON(request, response, 405, { error: "Método não permitido" });
    return;
  }

  if (pathname === "/api/health") {
    sendJSON(request, response, 200, {
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      version: "1.1.0",
    }, { "Cache-Control": "no-store" });
    return;
  }

  if (pathname === "/api/sefaz-status") {
    if (!checkRateLimit(request, response, "monitor", RATE_LIMITS.monitor)) return;
    try {
      const force = url.searchParams.get("force") === "1";
      const data = await getMonitorData(force);
      sendJSON(request, response, 200, data);
    } catch (error) {
      sendJSON(request, response, 502, {
        error: "Não foi possível consultar o Monitor SEFAZ agora.",
        detail: error.message,
      });
    }
    return;
  }

  if (pathname === "/api/sefaz-history") {
    try {
      const force = url.searchParams.get("force") === "1";
      const data = await getMonitorHistory(force);
      sendJSON(request, response, 200, data, { "Cache-Control": "no-store" });
    } catch (error) {
      sendJSON(request, response, 502, {
        error: "Não foi possível carregar o histórico de instabilidades.",
        detail: error.message,
      });
    }
    return;
  }

  if (pathname === "/api/cnpj") {
    if (!checkRateLimit(request, response, "cnpj", RATE_LIMITS.cnpj)) return;
    const cnpj = String(url.searchParams.get("cnpj") || "").replace(/\D/g, "");
    if (cnpj.length !== 14) {
      sendJSON(request, response, 400, { error: "Informe um CNPJ com 14 dígitos." });
      return;
    }
    try {
      const force = url.searchParams.get("force") === "1";
      const data = await getCompanyData(cnpj, force);
      sendJSON(request, response, 200, data);
    } catch (error) {
      sendJSON(request, response, 502, {
        error: "Não foi possível consultar as fontes públicas agora.",
        detail: error.message,
      });
    }
    return;
  }

  if (pathname === "/robots.txt") {
    const body = [
      "User-agent: *",
      "Allow: /",
      `Sitemap: https://radar-fiscal-iyn3.onrender.com/sitemap.xml`,
      "",
    ].join("\n");
    sendText(request, response, 200, body);
    return;
  }

  if (pathname === "/sitemap.xml") {
    const today = new Date().toISOString().slice(0, 10);
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      "  <url>",
      `    <loc>${siteOrigin(request)}/</loc>`,
      `    <lastmod>${today}</lastmod>`,
      "    <changefreq>weekly</changefreq>",
      "    <priority>1.0</priority>",
      "  </url>",
      "</urlset>",
      "",
    ].join("\n");
    sendBuffer(request, response, 200, body, {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    });
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/privacidade") pathname = "/privacidade.html";
  serveStatic(request, response, pathname);
}

function createServer() {
  return http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendJSON(request, response, 500, {
        error: "Erro interno do servidor.",
        detail: error.message,
      });
    });
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`Radar Fiscal disponível em http://localhost:${PORT}`);
    console.log("APIs: /api/cnpj, /api/sefaz-status, /api/health");
  });
}

module.exports = {
  createServer,
  parseMonitorStates,
  resetRateLimits: () => rateBuckets.clear(),
};
