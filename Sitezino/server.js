"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const { createSerproCpfClient, validCpf, birthToSerpro } = require("./serpro-cpf");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5500;
const HOST = process.env.HOST || "0.0.0.0";
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
const PUBLIC_URL = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const LEGAL_SUPABASE_URL = String(process.env.LEGAL_SUPABASE_URL || "").replace(/\/+$/, "");
const LEGAL_SUPABASE_KEY = String(process.env.LEGAL_SUPABASE_PUBLISHABLE_KEY || "");
const legalSupabaseOrigin = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(LEGAL_SUPABASE_URL)
  ? LEGAL_SUPABASE_URL : "";

const BRASIL_API = "https://brasilapi.com.br/api/cnpj/v1/";
const IE_API = "https://publica.cnpj.ws/cnpj/";
const MONITOR_ORIGIN = "https://monitor.tecnospeed.com.br";
const DOCUMENTS = ["nfe", "nfce", "cte"];
const DATAJUD_KEY = String(process.env.DATAJUD_PUBLIC_KEY || "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==");
// A chave é pública e publicada oficialmente no wiki do CNJ; pode ser rotacionada.
// Apenas aliases conhecidos são permitidos, nunca URL de livre escolha do cliente.
const DATAJUD_TRIBUNALS = new Set([
  "tjsc","tjsp","tjpr","tjrs","tjrj","tjmg","tjba","tjpe","tjdft","tjgo",
  "tjmt","tjms","tjpa","tjpb","tjce","tjal","tjam","tjap","tjac","tjro",
  "tjrr","tjto","tjpi","tjma","tjse","tjrn","tjes","trf1","trf2","trf3",
  "trf4","trf5","trf6","tst","stj","tse"
]);

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
  datajud: 12,
};

const STATIC_FILES = {
  "/index.html": "text/html; charset=utf-8",
  "/cpf.html": "text/html; charset=utf-8",
  "/cpf.css": "text/css; charset=utf-8",
  "/cpf.js": "text/javascript; charset=utf-8",
  "/juridico.html": "text/html; charset=utf-8",
  "/juridico.css": "text/css; charset=utf-8",
  "/juridico.js": "text/javascript; charset=utf-8",
  "/juridico-gestao.html": "text/html; charset=utf-8",
  "/juridico-gestao.css": "text/css; charset=utf-8",
  "/juridico-portal.html": "text/html; charset=utf-8",
  "/juridico-portal.js": "text/javascript; charset=utf-8",
  "/juridico-investigacao.js": "text/javascript; charset=utf-8",
  "/rural-csv.js": "text/javascript; charset=utf-8",
  "/juridico-portal.css": "text/css; charset=utf-8",
  "/patrimonio.html": "text/html; charset=utf-8",
  "/patrimonio.css": "text/css; charset=utf-8",
  "/patrimonio.js": "text/javascript; charset=utf-8",
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
  `connect-src 'self' ${legalSupabaseOrigin} https://brasilapi.com.br https://publica.cnpj.ws https://fonts.googleapis.com https://fonts.gstatic.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com`,
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
const serproCpf = createSerproCpfClient();
let cpfHourlyBucket = { start: Date.now(), count: 0 };

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

function allowCpfGlobalBudget(request, response) {
  const now = Date.now();
  if (now - cpfHourlyBucket.start >= 60 * 60 * 1000) cpfHourlyBucket = { start: now, count: 0 };
  if (cpfHourlyBucket.count >= 20) {
    sendJSON(request, response, 429, { error: "Limite de consultas contratadas por hora atingido." }, { "Retry-After": "3600" });
    return false;
  }
  cpfHourlyBucket.count++;
  return true;
}
function readSmallJSON(request) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers["content-length"] || 0);
    if (!Number.isFinite(declared) || declared < 0 || declared > 1024) {
      request.resume();
      const error = new Error("request_too_large");
      error.statusCode = 413;
      reject(error);
      return;
    }
    const chunks = [];
    let bytes = 0;
    let finished = false;
    request.on("data", (chunk) => {
      if (finished) return;
      bytes += chunk.length;
      if (bytes > 1024) {
        finished = true;
        request.resume();
        const error = new Error("request_too_large");
        error.statusCode = 413;
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (finished) return;
      finished = true;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid_json")); }
    });
    request.on("error", (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    });
  });
}

function validCnpj(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!/^\d{14}$/.test(digits) || /^(\d)\1{13}$/.test(digits)) return false;
  for (const count of [12, 13]) {
    let weight = count - 7;
    let sum = 0;
    for (let index = 0; index < count; index++) {
      sum += Number(digits[index]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const remainder = sum % 11;
    if ((remainder < 2 ? 0 : 11 - remainder) !== Number(digits[count])) return false;
  }
  return true;
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


// Consulta gratuita a metadados processuais publicamente expostos pelo CNJ.
function queryDatajud(tribunal, number) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      size: 5,
      query: { term: { numeroProcesso: number } }
    });
    const req = https.request({
      hostname: "api-publica.datajud.cnj.jus.br",
      path: "/api_publica_" + tribunal + "/_search",
      method: "POST",
      headers: {
        Authorization: "APIKey " + DATAJUD_KEY,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        Accept: "application/json"
      },
      timeout: 6500
    }, (upstream) => {
      let body = "";
      upstream.setEncoding("utf8");
      upstream.on("data", chunk => {
        body += chunk;
        if (body.length > 600_000) req.destroy(new Error("Resposta pública muito grande."));
      });
      upstream.on("end", () => {
        if (upstream.statusCode !== 200) {
          reject(new Error("DataJud indisponível (HTTP " + upstream.statusCode + ")."));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error("Resposta inválida do CNJ.")); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Tempo limite do DataJud.")));
    req.on("error", reject);
    req.end(payload);
  });
}
function simplifyDatajud(payload, requestedNumber, tribunal) {
  const hits = Array.isArray(payload?.hits?.hits) ? payload.hits.hits : [];
  return {
    source: "CNJ DataJud — API Pública",
    sourceUrl: "https://datajud-wiki.cnj.jus.br/api-publica/",
    searchedAt: new Date().toISOString(),
    tribunal, number: requestedNumber,
    records: hits.map(hit => hit?._source).filter(p => p && String(p.numeroProcesso) === requestedNumber)
      .slice(0,5).map(p => ({
        numeroProcesso: String(p.numeroProcesso),
        tribunal: String(p.tribunal || "").slice(0,70),
        grau: String(p.grau || "").slice(0,70),
        classe: String(p.classe?.nome || p.classe?.codigo || "").slice(0,180),
        assuntos: Array.isArray(p.assuntos) ? p.assuntos.slice(0,8).map(a => String(a?.nome || a?.codigo || "").slice(0,100)) : [],
        orgaoJulgador: String(p.orgaoJulgador?.nome || "").slice(0,180),
        dataAjuizamento: String(p.dataAjuizamento || "").slice(0,40),
        movimentos: Array.isArray(p.movimentos)
          ? p.movimentos.slice(-15).map(m=>({
              nome: String(m?.nome || "").slice(0,180),
              dataHora: String(m?.dataHora || "").slice(0,40)
            })) : []
      })),
    coverage: "Somente metadados públicos do tribunal selecionado, sem processos sigilosos nem busca por partes.",
    status: hits.length ? "found" : "no_match"
  };
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

  const rawHost = String(request.headers.host || "localhost");
  const host = /^[a-z0-9.:-]+$/i.test(rawHost) ? rawHost : "localhost";

  // Render terminates HTTPS before forwarding requests to the Node server over HTTP.
  // Keep this service's public sitemap URLs canonical even when TRUST_PROXY is disabled.
  if (host === "radar-fiscal-iyn3.onrender.com") return `https://${host}`;

  const forwardedProto = TRUST_PROXY
    ? String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim()
    : "";
  const protocol = forwardedProto === "https" || request.socket.encrypted ? "https" : "http";
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

    // Revalidação HTTP: economiza leitura em disco e transferência de CSS/JS/HTML.
    const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
    const lastModified = stats.mtime.toUTCString();
    const ifNoneMatch = String(request.headers["if-none-match"] || "");
    const ifModifiedSince = String(request.headers["if-modified-since"] || "");
    const notModified = ifNoneMatch
      ? ifNoneMatch.split(",").some((part) => part.trim() === etag || part.trim() === "*")
      : Boolean(ifModifiedSince) && Number.isFinite(Date.parse(ifModifiedSince))
        && Math.floor(stats.mtimeMs / 1000) <= Math.floor(Date.parse(ifModifiedSince) / 1000);
    if (notModified) {
      response.writeHead(304, {
        ...SECURITY_HEADERS,
        "ETag": etag,
        "Last-Modified": lastModified,
        "Cache-Control": "no-cache",
        "Vary": "Accept-Encoding",
      });
      response.end();
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
        "Last-Modified": lastModified,
        "ETag": etag,
        "Vary": "Accept-Encoding",
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

  if (pathname === "/api/juridico/config") {
    if (request.method !== "GET") {
      sendJSON(request, response, 405, { error: "Método não permitido." });
      return;
    }
    if (!legalSupabaseOrigin || !/^sb_publishable_[a-zA-Z0-9_-]+$/.test(LEGAL_SUPABASE_KEY)) {
      sendJSON(request, response, 503, { error: "Área privada ainda não configurada." });
      return;
    }
    sendJSON(request, response, 200, { url: legalSupabaseOrigin, publishableKey: LEGAL_SUPABASE_KEY });
    return;
  }

  // Endpoint privado opcional. Inativo por padrão, sem dados nos parâmetros da URL.
  if (pathname === "/api/cpf/status") {
    if (request.method !== "GET") {
      sendJSON(request, response, 405, { error: "Método não permitido." });
      return;
    }
    sendJSON(request, response, 200, { serproDisponivel: serproCpf.configured(), fonte: "Serpro Consulta CPF v3" });
    return;
  }

  if (pathname === "/api/cpf/consulta") {
    if (request.method !== "POST") {
      sendJSON(request, response, 405, { error: "Utilize POST para consulta privada." });
      return;
    }
    if (!serproCpf.configured()) {
      sendJSON(request, response, 503, { error: "Consulta Serpro não contratada ou não habilitada no Radar Fiscal." });
      return;
    }
    // Acesso administrativo apenas: não é endpoint público nem substitui autenticação de usuários.
    const auth = String(request.headers.authorization || "");
    const candidate = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!serproCpf.authorized(candidate)) {
      sendJSON(request, response, 401, { error: "Acesso administrativo não autorizado." });
      return;
    }
    if (!/^application\/json(?:;|$)/i.test(String(request.headers["content-type"] || ""))) {
      sendJSON(request, response, 415, { error: "Envie JSON no corpo da requisição." });
      return;
    }
    let body;
    try {
      body = await readSmallJSON(request);
    } catch (error) {
      if (!response.writableEnded && !response.destroyed) {
        const tooLarge = error.statusCode === 413;
        sendJSON(request, response, tooLarge ? 413 : 400, { error: tooLarge ? "JSON excede o limite de 1 KB." : "JSON inválido." });
      }
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.cpf !== "string" || typeof body.nascimento !== "string" ||
        typeof body.finalidade !== "string" || body.finalidade.trim().length < 10 ||
        body.finalidade.length > 180 || body.confirmacao !== true) {
      sendJSON(request, response, 400, { error: "Informe CPF, nascimento e finalidade legítima confirmada." });
      return;
    }
    if (!validCpf(body.cpf) || !birthToSerpro(body.nascimento)) {
      sendJSON(request, response, 400, { error: "CPF ou data de nascimento inválidos." });
      return;
    }
    if (!checkRateLimit(request, response, "cpf-private", 3)) return;
    if (!allowCpfGlobalBudget(request, response)) return;
    try {
      // Não armazenamos CPF, nascimento, finalidade ou resultado em disco, cache e logs.
      const data = await serproCpf.lookup(body.cpf, body.nascimento);
      sendJSON(request, response, 200, data);
    } catch (error) {
      const status = error.status === 404 ? 404 : 502;
      sendJSON(request, response, status, { error: error.message || "Não foi possível consultar o Serpro." });
    }
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
    if (!checkRateLimit(request, response, "monitor-history", 120)) return;
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

  if (pathname === "/api/juridico/datajud") {
    if (request.method !== "GET") {
      sendJSON(request, response, 405, { error: "Método não permitido." });
      return;
    }
    if (!checkRateLimit(request, response, "datajud", RATE_LIMITS.datajud)) return;
    const number = String(url.searchParams.get("numero") || "").replace(/\D/g, "");
    const tribunal = String(url.searchParams.get("tribunal") || "").toLowerCase();
    if (!/^\d{20}$/.test(number) || !DATAJUD_TRIBUNALS.has(tribunal)) {
      sendJSON(request, response, 400, { error: "Informe um número CNJ de 20 dígitos e tribunal válido." });
      return;
    }
    try {
      const data = await queryDatajud(tribunal, number);
      sendJSON(request, response, 200, simplifyDatajud(data, number, tribunal));
    } catch {
      sendJSON(request, response, 502, {
        status: "unavailable",
        error: "Não foi possível consultar o CNJ agora. Isso não significa ausência de processos."
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
    if (!validCnpj(cnpj)) {
      sendJSON(request, response, 400, { error: "CNPJ com dígitos verificadores inválidos." });
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
      "  <url>",
      `    <loc>${siteOrigin(request)}/cpf</loc>`,
      "  </url>",
      "  <url>",
      `    <loc>${siteOrigin(request)}/juridico</loc>`,
      "  </url>",
      "  <url>",
      `    <loc>${siteOrigin(request)}/patrimonio</loc>`,
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
  if (pathname === "/cpf" || pathname === "/cpf/") pathname = "/cpf.html";
  if (pathname === "/juridico" || pathname === "/juridico/") pathname = "/juridico.html";
  if (pathname === "/juridico/gestao" || pathname === "/juridico/gestao/") {
    // Esta página é apenas uma prévia sem dados reais. Nunca expor registros privados aqui.
    pathname = "/juridico-gestao.html";
  }
  if (pathname === "/juridico/portal" || pathname === "/juridico/portal/") pathname = "/juridico-portal.html";
  if (pathname === "/patrimonio" || pathname === "/patrimonio/") pathname = "/patrimonio.html";
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
