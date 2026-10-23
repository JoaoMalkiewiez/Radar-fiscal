"use strict";

/* ---------------------------------------------------------------------------
   Radar Fiscal — consulta de CNPJ, inscrições estaduais e situação na SEFAZ
   Fontes públicas: BrasilAPI (Receita Federal) e publica.cnpj.ws (IE/SEFAZ)
--------------------------------------------------------------------------- */

const API_BRASIL = "https://brasilapi.com.br/api/cnpj/v1/";
const API_IE = "https://publica.cnpj.ws/cnpj/";
const API_CNPJ = "/api/cnpj";
const SINTEGRA_URL = "https://www.sintegra.gov.br/";
const RECEITA_URL = "https://www.gov.br/receitafederal/pt-br";

const CACHE_PREFIX = "radarfiscal:cache:";
const RECENT_KEY = "radarfiscal:recent";
const THEME_KEY = "radarfiscal:theme";
const CACHE_TTL = 6 * 60 * 60 * 1000;
const MAX_RECENTS = 4;

const SEFAZ = {
  AC: { name: "Acre", url: "https://www.sefaz.ac.gov.br/" },
  AL: { name: "Alagoas", url: "https://www.sefaz.al.gov.br/" },
  AP: { name: "Amapá", url: "https://www.sefaz.ap.gov.br/" },
  AM: { name: "Amazonas", url: "https://www.sefaz.am.gov.br/" },
  BA: { name: "Bahia", url: "https://www.sefaz.ba.gov.br/" },
  CE: { name: "Ceará", url: "https://www.sefaz.ce.gov.br/" },
  DF: { name: "Distrito Federal", url: "https://www.sefaz.df.gov.br/" },
  ES: { name: "Espírito Santo", url: "https://www.sefaz.es.gov.br/" },
  GO: { name: "Goiás", url: "https://www.sefaz.go.gov.br/" },
  MA: { name: "Maranhão", url: "https://www.sefaz.ma.gov.br/" },
  MT: { name: "Mato Grosso", url: "https://www.sefaz.mt.gov.br/" },
  MS: { name: "Mato Grosso do Sul", url: "https://www.sefaz.ms.gov.br/" },
  MG: { name: "Minas Gerais", url: "https://www.fazenda.mg.gov.br/" },
  PA: { name: "Pará", url: "https://www.sefaz.pa.gov.br/" },
  PB: { name: "Paraíba", url: "https://www.sefaz.pb.gov.br/" },
  PR: { name: "Paraná", url: "https://www.fazenda.pr.gov.br/" },
  PE: { name: "Pernambuco", url: "https://www.sefaz.pe.gov.br/" },
  PI: { name: "Piauí", url: "https://www.sefaz.pi.gov.br/" },
  RJ: { name: "Rio de Janeiro", url: "https://www.fazenda.rj.gov.br/" },
  RN: { name: "Rio Grande do Norte", url: "https://www.sefaz.rn.gov.br/" },
  RS: { name: "Rio Grande do Sul", url: "https://www.sefaz.rs.gov.br/" },
  RO: { name: "Rondônia", url: "https://www.sefaz.ro.gov.br/" },
  RR: { name: "Roraima", url: "https://www.sefaz.rr.gov.br/" },
  SC: { name: "Santa Catarina", url: "https://www.sefaz.sc.gov.br/" },
  SP: { name: "São Paulo", url: "https://www.fazenda.sp.gov.br/" },
  SE: { name: "Sergipe", url: "https://www.sefaz.se.gov.br/" },
  TO: { name: "Tocantins", url: "https://www.sefaz.to.gov.br/" },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const els = {
  form: $("#search-form"),
  input: $("#cnpj"),
  box: $("#search-box"),
  btn: $("#btn-search"),
  btnLabel: $(".btn-label", $("#btn-search")),
  help: $("#cnpj-help"),
  examples: $("#examples"),
  recents: $("#recents"),
  recentsList: $("#recents-list"),
  results: $("#resultado"),
};

let requestToken = 0;
let currentCNPJ = null;
let lastLoadedFromCache = false;

/* ------------------------------------------------------------------ utils */

const escapeHTML = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));

const onlyDigits = (value) => String(value ?? "").replace(/\D/g, "").slice(0, 14);

function formatCNPJ(cnpj) {
  const d = onlyDigits(cnpj);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function isValidCNPJ(cnpj) {
  const d = onlyDigits(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;

  const calcDigit = (length) => {
    let weight = length - 7;
    let sum = 0;
    for (let i = 0; i < length; i += 1) {
      sum += Number(d[i]) * weight;
      weight -= 1;
      if (weight < 2) weight = 9;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  return calcDigit(12) === Number(d[12]) && calcDigit(13) === Number(d[13]);
}

function formatDate(value) {
  if (!value) return "Não informado";
  const date = new Date(String(value).slice(0, 10) + "T12:00:00");
  if (Number.isNaN(date.getTime())) return "Não informado";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "Não informado";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 2,
  }).format(number);
}

function formatPhone(ddd, number) {
  let digits = onlyDigits(number);
  if (!digits) return "";
  let area = String(ddd || "").replace(/\D/g, "");
  if (digits.length > 9) {
    area = area || digits.slice(0, 2);
    digits = digits.slice(2);
  }
  if (!area) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  const cut = digits.length > 8 ? 5 : 4;
  return `(${area}) ${digits.slice(0, cut)}-${digits.slice(cut)}`;
}

function initials(name) {
  const ignored = new Set(["de", "da", "do", "das", "dos", "e", "ltda", "me", "epp", "sa", "s", "a", "eireli"]);
  const words = String(name || "")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !ignored.has(word.toLowerCase()));
  const first = words[0]?.[0] || "";
  const second = words[1]?.[0] || "";
  return (first + second || "RF").toUpperCase();
}

function ufName(uf) {
  return SEFAZ[uf]?.name || "Estado";
}

function portalURL(uf) {
  return SEFAZ[uf]?.url || SINTEGRA_URL;
}

function safeStore(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage indisponível */ }
}

function safeRead(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function readCache(cnpj) {
  const raw = safeRead(CACHE_PREFIX + cnpj);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw);
    if (!entry?.result || !entry.savedAt || Date.now() - entry.savedAt > CACHE_TTL) return null;
    return entry;
  } catch {
    return null;
  }
}

function writeCache(cnpj, result) {
  if (result.ieSource === "unavailable") return;
  try {
    safeStore(CACHE_PREFIX + cnpj, JSON.stringify({ result, savedAt: Date.now() }));
  } catch { /* cache é opcional */ }
}

function readRecents() {
  try {
    const parsed = JSON.parse(safeRead(RECENT_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => item && isValidCNPJ(item.cnpj)).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

function addRecent(cnpj, name) {
  const entry = { cnpj, name: String(name || "Empresa consultada"), at: Date.now() };
  const others = readRecents().filter((item) => item.cnpj !== cnpj);
  const next = [entry, ...others].slice(0, MAX_RECENTS);
  safeStore(RECENT_KEY, JSON.stringify(next));
  renderRecents();
}

function renderRecents() {
  const recents = readRecents();
  if (!recents.length) {
    els.recents.hidden = true;
    return;
  }
  els.recentsList.innerHTML = recents.map((item) => `
    <button class="chip" type="button" data-cnpj="${item.cnpj}" title="Consultar novamente">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" style="width:11px;height:11px"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.7V8l2.2 1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
      ${escapeHTML(item.name)}
    </button>`).join("");
  els.recents.hidden = false;
}

function updateURL(cnpj, push) {
  try {
    const url = new URL(window.location.href);
    if (cnpj) url.searchParams.set("cnpj", cnpj);
    else url.searchParams.delete("cnpj");
    url.hash = "";
    if (push) history.pushState({ cnpj: cnpj || null }, "", url);
    else history.replaceState({ cnpj: cnpj || null }, "", url);
  } catch { /* file:// sem History API */ }
}

/* -------------------------------------------------------------------- API */

class LookupError extends Error {
  constructor(kind, message, status) {
    super(message);
    this.name = "LookupError";
    this.kind = kind;
    this.status = status || 0;
  }
}

async function getJSON(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.message || body?.detail || "";
      } catch { /* corpo não-JSON */ }
      const error = new Error(detail || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new LookupError("timeout", "A consulta demorou mais que o esperado.", 0);
    }
    if (error instanceof LookupError) throw error;
    if (typeof error.status !== "number" || !error.status) {
      throw new LookupError("network", "Não foi possível conectar à fonte de dados.", 0);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function mapBrasilAPI(raw) {
  return {
    cnpj: raw.cnpj || "",
    razaoSocial: raw.razao_social || "",
    nomeFantasia: raw.nome_fantasia || "",
    situacao: raw.descricao_situacao_cadastral || "",
    dataSituacao: raw.data_situacao_cadastral || "",
    inicioAtividade: raw.data_inicio_atividade || "",
    naturezaJuridica: raw.natureza_juridica || "",
    porte: raw.porte || "",
    capitalSocial: raw.capital_social != null ? Number(raw.capital_social) : null,
    matrizFilial: raw.descricao_identificador_matriz_filial || "",
    cnaeCodigo: raw.cnae_fiscal != null ? String(raw.cnae_fiscal) : "",
    cnaeDescricao: raw.cnae_fiscal_descricao || "",
    cnaesSecundarios: Array.isArray(raw.cnaes_secundarios)
      ? raw.cnaes_secundarios.map((item) => ({ codigo: String(item.codigo ?? ""), descricao: item.descricao || "" }))
      : [],
    uf: raw.uf || "",
    municipio: raw.municipio || "",
    cep: raw.cep || "",
    logradouro: [raw.descricao_tipo_de_logradouro, raw.logradouro].filter(Boolean).join(" "),
    numero: raw.numero || "",
    complemento: raw.complemento || "",
    bairro: raw.bairro || "",
    ddd: raw.ddd_telefone_1 ? String(raw.ddd_telefone_1).slice(0, 2) : "",
    telefone: raw.ddd_telefone_1 ? String(raw.ddd_telefone_1).slice(2) : "",
    email: raw.email || "",
    mei: typeof raw.opcao_pelo_mei === "boolean" ? raw.opcao_pelo_mei : null,
    simples: typeof raw.opcao_pelo_simples === "boolean" ? raw.opcao_pelo_simples : null,
    qsa: Array.isArray(raw.qsa)
      ? raw.qsa.map((member) => ({
          nome: member.nome_socio || "",
          qualificacao: member.qualificacao_socio || "",
          desde: member.data_entrada_sociedade || "",
          documento: member.cnpj_cpf_do_socio || "",
        }))
      : [],
    atualizadoEm: null,
  };
}

function mapPublica(raw) {
  const establishment = raw.estabelecimento || {};
  const simples = raw.simples || null;
  const boolFromS = (value) => (value === "S" ? true : value === "N" ? false : null);
  return {
    cnpj: establishment.cnpj || "",
    razaoSocial: raw.razao_social || "",
    nomeFantasia: establishment.nome_fantasia || "",
    situacao: establishment.situacao_cadastral || "",
    dataSituacao: establishment.data_situacao_cadastral || "",
    inicioAtividade: establishment.data_inicio_atividade || "",
    naturezaJuridica: raw.natureza_juridica?.descricao || "",
    porte: raw.porte?.descricao || "",
    capitalSocial: raw.capital_social != null ? Number(raw.capital_social) : null,
    matrizFilial: establishment.tipo || "",
    cnaeCodigo: establishment.atividade_principal?.subclasse || establishment.atividade_principal?.id || "",
    cnaeDescricao: establishment.atividade_principal?.descricao || "",
    cnaesSecundarios: Array.isArray(establishment.atividades_secundarias)
      ? establishment.atividades_secundarias.map((item) => ({ codigo: String(item.subclasse || item.id || ""), descricao: item.descricao || "" }))
      : [],
    uf: establishment.estado?.sigla || "",
    municipio: establishment.cidade?.nome || "",
    cep: establishment.cep || "",
    logradouro: [establishment.tipo_logradouro, establishment.logradouro].filter(Boolean).join(" "),
    numero: establishment.numero || "",
    complemento: establishment.complemento || "",
    bairro: establishment.bairro || "",
    ddd: establishment.ddd1 || "",
    telefone: establishment.telefone1 || "",
    email: establishment.email || "",
    mei: boolFromS(simples?.mei),
    simples: boolFromS(simples?.simples),
    qsa: Array.isArray(raw.socios)
      ? raw.socios.map((member) => ({
          nome: member.nome || "",
          qualificacao: member.qualificacao_socio?.descricao || "",
          desde: member.data_entrada || "",
          documento: member.cpf_cnpj_socio || "",
        }))
      : [],
    atualizadoEm: establishment.atualizado_em || raw.atualizado_em || null,
  };
}

function mergeCompany(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  const merged = { ...primary };
  Object.keys(secondary).forEach((key) => {
    const value = secondary[key];
    const isEmpty = merged[key] == null
      || merged[key] === ""
      || (Array.isArray(merged[key]) && merged[key].length === 0);
    if (isEmpty && value !== "" && value != null) merged[key] = value;
  });
  if (secondary.capitalSocial != null && secondary.capitalSocial > 0) merged.capitalSocial = secondary.capitalSocial;
  if (secondary.atualizadoEm) merged.atualizadoEm = secondary.atualizadoEm;
  return merged;
}

function extractIEs(raw) {
  const list = raw?.estabelecimento?.inscricoes_estaduais;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      numero: String(item.inscricao_estadual ?? "").trim(),
      ativo: Boolean(item.ativo),
      uf: item.estado?.sigla || "",
      estado: item.estado?.nome || "",
      atualizadoEm: item.atualizado_em || null,
    }))
    .filter((item) => item.numero && item.uf)
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.uf.localeCompare(b.uf, "pt-BR"));
}

function sourceErrorFromServer(info) {
  if (!info) return null;
  const status = Number(info.status) || 0;
  const kind = info.kind || (status === 429 ? "rate-limit" : status === 404 ? "not-found" : status ? "http" : "network");
  return new LookupError(kind, info.message || "Falha ao consultar a fonte pública.", status);
}

async function fetchCompanyData(cnpj, options = {}) {
  let brasilRaw = null;
  let ieRaw = null;
  let brasilError = null;
  let ieError = null;
  let stale = false;
  let serverFetchedAt = 0;
  let usedServer = false;

  // O servidor mantém cache e repete consultas transitórias. Em hospedagem
  // estática, o bloco abaixo falha de forma silenciosa e usamos as APIs direto.
  try {
    const query = `?cnpj=${encodeURIComponent(cnpj)}${options.force ? "&force=1" : ""}`;
    const payload = await getJSON(API_CNPJ + query);
    if (payload && (payload.brasil || payload.ie || payload.brasilError || payload.ieError)) {
      usedServer = true;
      brasilRaw = payload.brasil || null;
      ieRaw = payload.ie || null;
      brasilError = sourceErrorFromServer(payload.brasilError);
      ieError = sourceErrorFromServer(payload.ieError);
      stale = Boolean(payload.stale);
      const parsed = payload.fetchedAt ? Date.parse(payload.fetchedAt) : NaN;
      if (Number.isFinite(parsed)) serverFetchedAt = parsed;
    }
  } catch (error) {
    if (error?.status === 429) {
      throw new LookupError("rate-limit", "Muitas consultas em pouco tempo. Aguarde um instante e tente novamente.", 429);
    }
    // 404, 5xx ou servidor indisponível: segue com as APIs públicas direto.
  }

  if (!usedServer) {
    const [brasilResult, ieResult] = await Promise.allSettled([
      getJSON(API_BRASIL + cnpj),
      getJSON(API_IE + cnpj),
    ]);

    brasilRaw = brasilResult.status === "fulfilled" ? brasilResult.value : null;
    ieRaw = ieResult.status === "fulfilled" ? ieResult.value : null;
    brasilError = brasilResult.status === "rejected" ? brasilResult.reason : null;
    ieError = ieResult.status === "rejected" ? ieResult.reason : null;
  }

  if (!brasilRaw && !ieRaw) {
    const statuses = [brasilError?.status, ieError?.status];
    if (statuses.every((status) => status === 404)) {
      throw new LookupError("not-found", "CNPJ não encontrado nas bases públicas.", 404);
    }
    if (statuses.includes(429)) {
      throw new LookupError("rate-limit", "O limite de consultas da fonte pública foi atingido.", 429);
    }
    if (statuses.includes(0)) {
      throw new LookupError("network", "As fontes de dados não responderam.", 0);
    }
    throw new LookupError("unavailable", "As fontes públicas estão indisponíveis no momento.", 0);
  }

  const base = brasilRaw ? mapBrasilAPI(brasilRaw) : mapPublica(ieRaw);
  const alternative = ieRaw ? mapPublica(ieRaw) : null;
  const company = mergeCompany(base, alternative);

  if (!company.razaoSocial) company.razaoSocial = "Empresa sem nome informado";
  if (!company.cnpj) company.cnpj = cnpj;

  const ies = ieRaw ? extractIEs(ieRaw) : [];
  const ieStatus = ieRaw ? "ok" : ieError?.status === 404 ? "not-found" : "unavailable";

  const result = {
    cnpj,
    company,
    ies,
    ieSource: ieStatus,
    ieErrorKind: ieError?.status === 429 ? "rate-limit" : ieError ? "network" : null,
    registryUpdatedAt: company.atualizadoEm || null,
    fetchedAt: serverFetchedAt || Date.now(),
    source: brasilRaw ? "BrasilAPI · Receita Federal" : "publica.cnpj.ws · Receita Federal",
  };
  if (stale) result.stale = true;
  if (usedServer) result.viaServer = true;
  return result;
}

/* --------------------------------------------------------------- rendering */

const plural = (count, singular, pluralForm) => `${count} ${count === 1 ? singular : pluralForm}`;

function formatCEP(value) {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : String(value || "");
}

function formatCNAE(value) {
  const code = String(value || "");
  const digits = code.replace(/\D/g, "");
  if (digits.length === 7) return `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
  return code;
}

function situationInfo(situation) {
  const text = String(situation || "").toUpperCase();
  if (!text) return { label: "Não informada", tone: "neutral", short: "—" };
  if (text.includes("ATIVA") && !text.includes("INATIVA")) return { label: situation, tone: "active", short: "Ativa" };
  if (/(BAIXADA|INATIVA|INAPTA|SUSPENSA|NULA)/.test(text)) return { label: situation, tone: "inactive", short: situation };
  return { label: situation, tone: "warn", short: situation };
}

function sefazSummary(ies, source) {
  if (source === "unavailable") {
    return { label: "Não consultada", tone: "warn", note: "Fonte de IE indisponível" };
  }
  if (!ies.length) {
    return { label: "Não localizada", tone: "neutral", note: "Nenhuma IE retornada" };
  }
  const active = ies.filter((ie) => ie.ativo).length;
  if (active > 0) {
    return {
      label: "Ativa",
      tone: "active",
      note: `${active} de ${plural(ies.length, "inscrição", "inscrições")} ${ies.length === 1 ? "ativa" : "ativas"}`,
    };
  }
  return {
    label: "Inativa",
    tone: "inactive",
    note: `Todas as ${plural(ies.length, "inscrição", "inscrições")} estão inativas`,
  };
}

function yesNo(value) {
  if (value === true) return "Sim";
  if (value === false) return "Não";
  return "Não informado";
}

function buildAddress(company) {
  const street = [company.logradouro, company.numero].filter(Boolean).join(", ");
  const details = [company.complemento, company.bairro].filter(Boolean).join(" · ");
  const city = [company.municipio, company.uf].filter(Boolean).join(" — ");
  const cep = company.cep ? `CEP ${formatCEP(company.cep)}` : "";
  return { street, details, city, cep, has: Boolean(street || details || city) };
}

function renderPortalGrid() {
  const grid = $("#portal-grid");
  if (!grid) return;
  grid.innerHTML = Object.entries(SEFAZ)
    .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
    .map(([uf, data]) => `
      <a class="portal-link" href="${data.url}" target="_blank" rel="noopener noreferrer" title="Portal da SEFAZ — ${escapeHTML(data.name)}">
        <span class="uf">${uf}</span>
        <span class="state">${escapeHTML(data.name)}</span>
      </a>`)
    .join("");
}

function renderLoading(cnpj) {
  currentResult = null;
  els.results.hidden = false;
  els.results.setAttribute("aria-busy", "true");
  els.results.innerHTML = `
    <div class="skeleton-card" role="status">
      <div class="skeleton-copy">
        <span class="spinner-dark" aria-hidden="true"></span>
        Consultando ${formatCNPJ(cnpj)} nas bases públicas…
      </div>
      <div class="sk-top">
        <div class="sk sk-line sk-line--sm"></div>
        <div class="sk sk-line" style="width:94px"></div>
      </div>
      <div class="sk-head">
        <div class="sk sk-avatar"></div>
        <div class="sk-lines">
          <div class="sk sk-line sk-line--lg"></div>
          <div class="sk sk-line sk-line--md"></div>
          <div class="sk sk-line sk-line--sm"></div>
        </div>
        <div class="sk-status">
          <div class="sk" style="width:110px;height:48px"></div>
          <div class="sk" style="width:110px;height:48px"></div>
        </div>
      </div>
      <div class="sk-metrics">
        <div class="sk sk-metric"></div>
        <div class="sk sk-metric"></div>
        <div class="sk sk-metric"></div>
      </div>
      <div class="sk-body">
        <div class="sk sk-panel"></div>
        <div class="sk sk-panel"></div>
      </div>
    </div>`;
}

function renderError(error, cnpj) {
  currentResult = null;
  const kind = error?.kind || "unavailable";
  const messages = {
    "not-found": {
      title: "CNPJ não encontrado",
      text: "Não localizamos este CNPJ nas bases públicas. Confira se os 14 dígitos estão corretos e se a empresa já possui cadastro na Receita Federal.",
      action: '<button class="btn btn--solid" type="button" data-action="new">Corrigir CNPJ</button>',
      hint: "Dica: um CNPJ válido tem 14 dígitos, com dois dígitos verificadores.",
    },
    "rate-limit": {
      title: "Limite de consultas atingido",
      text: "A fonte pública de dados limita o número de consultas por minuto. Aguarde cerca de um minuto e tente novamente. Você também pode conferir a inscrição diretamente no portal da SEFAZ.",
      action: `<button class="btn btn--solid" type="button" data-action="retry" data-cnpj="${cnpj}">Tentar novamente</button>`,
      hint: "Se a empresa já foi consultada neste navegador, o resultado salvo ainda pode ser usado pela busca.",
    },
    network: {
      title: "Não foi possível conectar",
      text: "As fontes públicas não responderam. Verifique sua conexão com a internet e tente novamente em instantes.",
      action: `<button class="btn btn--solid" type="button" data-action="retry" data-cnpj="${cnpj}">Tentar novamente</button>`,
      hint: "Você também pode consultar o CNPJ no portal da Receita Federal.",
    },
    unavailable: {
      title: "Consulta temporariamente indisponível",
      text: "As bases públicas estão instáveis neste momento. Tente novamente em alguns instantes ou consulte diretamente os portais oficiais.",
      action: `<button class="btn btn--solid" type="button" data-action="retry" data-cnpj="${cnpj}">Tentar novamente</button>`,
      hint: "Os portais da SEFAZ e o SINTEGRA continuam disponíveis.",
    },
  };
  const content = messages[kind] || messages.unavailable;

  els.results.hidden = false;
  els.results.setAttribute("aria-busy", "false");
  els.results.innerHTML = `
    <div class="error-card" role="alert">
      <div class="error-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10.3 3.9L2.8 17a2 2 0 001.7 3h15a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </div>
      <div>
        <h2>${escapeHTML(content.title)}</h2>
        <p>${escapeHTML(content.text)}</p>
        <div class="error-actions">
          ${content.action}
          <a class="btn btn--outline" href="${SINTEGRA_URL}" target="_blank" rel="noopener noreferrer">Abrir SINTEGRA
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </a>
        </div>
        <p class="error-hint">${escapeHTML(content.hint)} <a href="${RECEITA_URL}" target="_blank" rel="noopener noreferrer">Ir à Receita Federal</a>.</p>
      </div>
    </div>`;
}

function renderIECard(ie) {
  const updated = ie.atualizadoEm
    ? `Base atualizada em ${formatDate(ie.atualizadoEm)}`
    : "Data de atualização não informada";
  return `
    <article class="ie-card">
      <div class="ie-main">
        <span class="uf-seal" aria-hidden="true">${escapeHTML(ie.uf)}</span>
        <div class="ie-info">
          <div class="ie-state">${escapeHTML(ie.estado || ufName(ie.uf))}</div>
          <div class="ie-number">
            <span>${escapeHTML(ie.numero)}</span>
            <button class="copy-btn" type="button" data-copy="${escapeHTML(ie.numero)}" aria-label="Copiar inscrição estadual ${escapeHTML(ie.numero)}">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.3"/></svg>
              Copiar
            </button>
          </div>
        </div>
        <span class="status-pill ${ie.ativo ? "active" : "inactive"}"><span class="dot" aria-hidden="true"></span>${ie.ativo ? "Ativa" : "Inativa"}</span>
      </div>
      <div class="ie-foot">
        <span>${updated}</span>
        <a href="${portalURL(ie.uf)}" target="_blank" rel="noopener noreferrer">
          Portal SEFAZ-${escapeHTML(ie.uf)}
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3h7v7M13 3L4 12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </a>
      </div>
    </article>`;
}

function renderIEList(result) {
  const { company, ies, ieSource } = result;

  if (ieSource === "unavailable") {
    return `
      <div class="ie-empty">
        <div class="ie-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/></svg>
        </div>
        <h4>Inscrições estaduais indisponíveis</h4>
        <p>A fonte pública de IE não respondeu nesta consulta. Os demais dados cadastrais foram carregados normalmente. Tente atualizar ou confirme diretamente na SEFAZ.</p>
        <div class="empty-actions">
          <button class="btn btn--outline" type="button" data-action="refresh">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 11-1.5-3.5M13 2v3.5H9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Tentar novamente
          </button>
          <a class="btn btn--solid" href="${portalURL(company.uf)}" target="_blank" rel="noopener noreferrer">Abrir SEFAZ${company.uf ? "-" + escapeHTML(company.uf) : ""}</a>
        </div>
      </div>`;
  }

  if (!ies.length) {
    return `
      <div class="ie-empty">
        <div class="ie-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5h16M4 12h10M4 17.5h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="18" cy="16.5" r="3.2" stroke="currentColor" stroke-width="1.5"/><path d="M18 14.8v1.8l1.2 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </div>
        <h4>Nenhuma IE localizada</h4>
        <p>Não encontramos Inscrição Estadual para este CNPJ na base pública. Isso é comum para MEIs, empresas que prestam apenas serviços e inscrições recentes. Confirme no portal da SEFAZ do estado ou no SINTEGRA.</p>
        <div class="empty-actions">
          ${company.uf ? `<a class="btn btn--solid" href="${portalURL(company.uf)}" target="_blank" rel="noopener noreferrer">Abrir SEFAZ-${escapeHTML(company.uf)}</a>` : ""}
          <a class="btn btn--outline" href="${SINTEGRA_URL}" target="_blank" rel="noopener noreferrer">Consultar SINTEGRA</a>
        </div>
      </div>`;
  }

  return `<div class="ie-list">${ies.map(renderIECard).join("")}</div>`;
}

function renderNotices(result, fromCache) {
  const notices = [];

  if (fromCache) {
    notices.push(`
      <div class="notice notice--info">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/><path d="M10 9v4M10 6.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <div>Exibindo um resultado salvo neste navegador em ${formatDateTime(result.fetchedAt)}. Use <strong>Atualizar</strong> para consultar as fontes novamente.</div>
      </div>`);
  }

  if (result.stale) {
    notices.push(`
      <div class="notice notice--info">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/><path d="M10 9v4M10 6.5v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        <div>Uma das fontes públicas não respondeu agora. Exibindo a última versão disponível no cache do servidor; tente <strong>Atualizar</strong> em instantes.</div>
      </div>`);
  }

  if (result.ieSource === "unavailable") {
    const reason = result.ieErrorKind === "rate-limit"
      ? "A fonte pública de Inscrições Estaduais atingiu o limite de consultas."
      : "A fonte pública de Inscrições Estaduais não respondeu.";
    notices.push(`
      <div class="notice notice--warn">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 6v5M10 14v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/></svg>
        <div>${reason} Os dados cadastrais abaixo vêm da Receita Federal. Tente atualizar em instantes ou consulte a IE no portal da SEFAZ.</div>
      </div>`);
  }

  return notices.join("");
}

function renderCompanyHead(result) {
  const { company, ies, ieSource } = result;
  const receita = situationInfo(company.situacao);
  const sefaz = sefazSummary(ies, ieSource);
  const tags = [];

  if (company.matrizFilial) {
    tags.push(`<span class="tag"><svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 12V5l5-3 5 3v7M2 12h10M5.5 12V8h3v4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>${escapeHTML(company.matrizFilial)}</span>`);
  }
  if (company.municipio || company.uf) {
    tags.push(`<span class="tag"><svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 12.5S11 9.1 11 5.8a4 4 0 10-8 0c0 3.3 4 6.7 4 6.7z" stroke="currentColor" stroke-width="1.2"/><circle cx="7" cy="5.8" r="1.4" stroke="currentColor" stroke-width="1.1"/></svg>${escapeHTML([company.municipio, company.uf].filter(Boolean).join(" · "))}</span>`);
  }
  if (company.inicioAtividade) {
    tags.push(`<span class="tag">Desde ${escapeHTML(String(company.inicioAtividade).slice(0, 4))}</span>`);
  }
  if (company.mei === true) tags.push('<span class="tag">MEI</span>');
  else if (company.simples === true) tags.push('<span class="tag">Simples Nacional</span>');

  return `
    <div class="company-head">
      <div class="company-id">
        <div class="company-monogram" aria-hidden="true">${escapeHTML(initials(company.razaoSocial))}</div>
        <div class="company-name">
          <h2>${escapeHTML(company.razaoSocial)}</h2>
          ${company.nomeFantasia && company.nomeFantasia.toUpperCase() !== company.razaoSocial.toUpperCase()
            ? `<div class="company-fantasia">${escapeHTML(company.nomeFantasia)}</div>` : ""}
          <div class="company-cnpj">
            <span>CNPJ ${formatCNPJ(company.cnpj || result.cnpj)}</span>
            <button class="copy-btn" type="button" data-copy="${onlyDigits(company.cnpj || result.cnpj)}" aria-label="Copiar CNPJ">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.3"/></svg>
              Copiar
            </button>
          </div>
          <div class="company-tags">${tags.join("")}</div>
        </div>
      </div>
      <div class="status-stack">
        <div class="status-box is-${receita.tone}">
          <span class="status-label">Receita Federal</span>
          <strong><span class="dot" aria-hidden="true"></span>${escapeHTML(receita.label)}</strong>
        </div>
        <div class="status-box is-${sefaz.tone}">
          <span class="status-label">SEFAZ</span>
          <strong><span class="dot" aria-hidden="true"></span>${escapeHTML(sefaz.label)}</strong>
        </div>
      </div>
    </div>`;
}

function renderMetrics(result) {
  const { ies, ieSource, company } = result;
  const active = ies.filter((ie) => ie.ativo).length;
  const inactive = ies.length - active;
  const states = [...new Set(ies.map((ie) => ie.uf))];
  const sefaz = sefazSummary(ies, ieSource);
  const updated = result.registryUpdatedAt ? formatDate(result.registryUpdatedAt) : formatDate(result.fetchedAt);

  const note = ieSource === "unavailable"
    ? "Fonte de IE indisponível"
    : ies.length
      ? `<span class="good">${active} ativa${active === 1 ? "" : "s"}</span> · <span class="${inactive ? "bad" : ""}">${inactive} inativa${inactive === 1 ? "" : "s"}</span>`
      : "Nenhuma inscrição retornada";

  return `
    <div class="result-metrics">
      <div class="metric">
        <span class="metric-value">${ies.length}</span>
        <span class="metric-label">Inscrições estaduais</span>
        <span class="metric-note">${note}</span>
      </div>
      <div class="metric">
        <span class="metric-value">${states.length}</span>
        <span class="metric-label">Estados vinculados</span>
        <span class="metric-note">${states.length ? states.map(escapeHTML).join(" · ") : "Nenhum estado"}</span>
      </div>
      <div class="metric">
        <span class="metric-value metric-value--small">${escapeHTML(updated)}</span>
        <span class="metric-label">Atualização da base</span>
        <span class="metric-note">${escapeHTML(sefaz.note)}</span>
      </div>
    </div>`;
}

function renderFicha(company) {
  const cnae = company.cnaeDescricao
    ? `${company.cnaeCodigo ? `<span class="mono">${escapeHTML(formatCNAE(company.cnaeCodigo))}</span> · ` : ""}${escapeHTML(company.cnaeDescricao)}`
    : "Não informado";

  return `
    <section class="card side-card" aria-labelledby="ficha-title">
      <div class="card-head">
        <div>
          <h3 id="ficha-title">Ficha cadastral</h3>
          <p>Dados da Receita Federal</p>
        </div>
      </div>
      <dl class="ficha">
        <div class="ficha-row"><dt>Situação cadastral</dt><dd>${escapeHTML(company.situacao || "Não informada")}${company.dataSituacao ? ` · desde ${escapeHTML(formatDate(company.dataSituacao))}` : ""}</dd></div>
        <div class="ficha-row"><dt>Natureza jurídica</dt><dd>${escapeHTML(company.naturezaJuridica || "Não informada")}</dd></div>
        <div class="ficha-row"><dt>Porte</dt><dd>${escapeHTML(company.porte || "Não informado")}</dd></div>
        <div class="ficha-row"><dt>Capital social</dt><dd>${escapeHTML(formatCurrency(company.capitalSocial))}</dd></div>
        <div class="ficha-row"><dt>Início de atividade</dt><dd>${escapeHTML(formatDate(company.inicioAtividade))}</dd></div>
        <div class="ficha-row"><dt>Simples Nacional / MEI</dt><dd>${yesNo(company.simples)} / ${yesNo(company.mei)}</dd></div>
        <div class="ficha-row"><dt>CNAE principal</dt><dd>${cnae}</dd></div>
      </dl>
    </section>`;
}

function renderLocation(company) {
  const address = buildAddress(company);
  const phone = formatPhone(company.ddd, company.telefone);
  if (!address.has && !phone && !company.email) return "";

  const lines = [address.street, address.details, [address.city, address.cep].filter(Boolean).join(" · ")].filter(Boolean);

  return `
    <section class="card side-card" aria-labelledby="local-title">
      <div class="card-head">
        <div>
          <h3 id="local-title">Localização e contato</h3>
          <p>Endereço do estabelecimento</p>
        </div>
      </div>
      ${address.has ? `
        <div class="address">
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M9 16.2S14.5 11.7 14.5 7.4a5.5 5.5 0 10-11 0c0 4.3 5.5 8.8 5.5 8.8z" stroke="currentColor" stroke-width="1.3"/><circle cx="9" cy="7.4" r="1.9" stroke="currentColor" stroke-width="1.2"/></svg>
          <div>${lines.map(escapeHTML).join("<br>")}</div>
        </div>` : ""}
      ${(phone || company.email) ? `
        <div class="contact-links">
          ${phone ? `<a href="tel:+55${onlyDigits(company.ddd + company.telefone)}"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 2.8h3l1 3-1.8 1.2a8.5 8.5 0 003.8 3.8L10.2 9l3 1v3c0 .6-.5 1-1 1C6.6 14 2 9.4 2 3.8c0-.5.4-1 1-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg><span>${escapeHTML(phone)}</span></a>` : ""}
          ${company.email ? `<a href="mailto:${escapeHTML(company.email)}"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M2.5 4.5L8 9l5.5-4.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span>${escapeHTML(company.email)}</span></a>` : ""}
        </div>` : ""}
    </section>`;
}

function renderExtras(company) {
  const extras = [];

  if (company.qsa.length) {
    extras.push(`
      <details class="extra">
        <summary>
          <span class="summary-left">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="5.5" cy="5" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M1.8 13c0-2.1 1.6-3.6 3.7-3.6s3.7 1.5 3.7 3.6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M10.5 5.5a2 2 0 100-4M11.2 9.6c1.8.2 3 1.6 3 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            Sócios e administradores
            <span class="summary-count">${company.qsa.length}</span>
          </span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </summary>
        <div class="extra-body">
          <div class="partner-grid">
            ${company.qsa.map((member) => `
              <div class="partner">
                <strong title="${escapeHTML(member.nome)}">${escapeHTML(member.nome || "Não informado")}</strong>
                <span>${escapeHTML(member.qualificacao || "Qualificação não informada")}${member.desde ? ` · desde ${escapeHTML(formatDate(member.desde))}` : ""}</span>
              </div>`).join("")}
          </div>
        </div>
      </details>`);
  }

  if (company.cnaesSecundarios.length) {
    extras.push(`
      <details class="extra">
        <summary>
          <span class="summary-left">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
            Atividades secundárias
            <span class="summary-count">${company.cnaesSecundarios.length}</span>
          </span>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </summary>
        <div class="extra-body">
          <div class="cnae-list">
            ${company.cnaesSecundarios.map((item) => `
              <div class="cnae-item">
                <span class="cnae-code">${escapeHTML(formatCNAE(item.codigo))}</span>
                <span>${escapeHTML(item.descricao)}</span>
              </div>`).join("")}
          </div>
        </div>
      </details>`);
  }

  return extras.length ? `<div class="extras">${extras.join("")}</div>` : "";
}

function renderResult(result, options = {}) {
  const fromCache = Boolean(options.fromCache);
  const company = result.company;
  const ies = result.ies || [];
  const updatedAt = result.registryUpdatedAt ? formatDate(result.registryUpdatedAt) : null;

  currentResult = result;
  els.results.hidden = false;
  els.results.setAttribute("aria-busy", "false");
  els.results.innerHTML = `
    <div class="result-card">
      <div class="result-inner">
        <div class="result-top">
          <p class="result-kicker">
            <span class="dot" aria-hidden="true"></span>
            ${fromCache ? "Resultado salvo" : "Consulta concluída"}
            <span class="sep" aria-hidden="true">·</span>
            <time datetime="${new Date(result.fetchedAt).toISOString()}">${formatDateTime(result.fetchedAt)}</time>
          </p>
          <div class="result-actions">
            <button class="btn btn--outline" type="button" data-action="refresh" data-cnpj="${escapeHTML(result.cnpj)}" title="Consultar as fontes novamente">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 8a5 5 0 11-1.5-3.5M13 2v3.5H9.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Atualizar
            </button>
            <button class="btn btn--outline" type="button" data-action="new">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
              Nova consulta
            </button>
          </div>
        </div>
        ${renderNotices(result, fromCache)}
        ${renderCompanyHead(result)}
        ${renderMetrics(result)}
        <div class="result-body">
          <section class="card" aria-labelledby="ie-title">
            <div class="card-head">
              <div>
                <h3 id="ie-title">Inscrições estaduais</h3>
                <p>Situação da IE na base pública de cada estado</p>
              </div>
              <span class="count-badge" title="Inscrições encontradas">${ies.length}</span>
            </div>
            ${renderIEList(result)}
          </section>
          <div class="side-stack">
            ${renderFicha(company)}
            ${renderLocation(company)}
          </div>
        </div>
        <section class="card services-card" id="servicos" aria-labelledby="services-title">
          <div class="card-head">
            <div>
              <h3 id="services-title">Serviços fiscais na SEFAZ</h3>
              <p>Disponibilidade de NF-e, NFC-e e CT-e nos estados desta empresa</p>
            </div>
            <a class="source-tag" href="${MONITOR_URL}" target="_blank" rel="noopener noreferrer" title="Abrir o Monitor SEFAZ da TecnoSpeed"><i aria-hidden="true"></i>TecnoSpeed</a>
          </div>
          <div class="services-list" data-services></div>
        </section>
        ${renderExtras(company)}
        <div class="result-note">
          <p>
            Fontes: ${escapeHTML(result.source)}${result.ieSource === "ok" ? " + publica.cnpj.ws (inscrições estaduais)" : ""}.
            ${updatedAt ? `Base cadastral atualizada em ${escapeHTML(updatedAt)}.` : ""}
            Dados informativos — confirme sempre nos portais oficiais da SEFAZ.
          </p>
          <a href="${RECEITA_URL}" target="_blank" rel="noopener noreferrer">Verificar na Receita Federal</a>
        </div>
      </div>
    </div>`;
  renderResultServices();
}

/* ------------------------------------------------------------------- flow */

function setHelp(message, tone = "") {
  els.help.textContent = message;
  els.help.className = "help-text" + (tone ? ` ${tone}` : "");
}

function validateInput(digits = onlyDigits(els.input.value)) {
  const length = digits.length;
  const valid = length === 14 && isValidCNPJ(digits);
  els.input.setAttribute("aria-invalid", length === 14 && !valid ? "true" : "false");

  if (!length) {
    setHelp("Digite os 14 números do CNPJ.");
  } else if (length < 14) {
    setHelp(`${length} de 14 dígitos informados.`);
  } else if (valid) {
    setHelp("CNPJ válido — pronto para consultar.", "ok");
  } else {
    setHelp("Dígitos verificadores inválidos. Confira o número.", "error");
  }
  return valid;
}

function setLoading(isLoading) {
  els.btn.disabled = isLoading;
  els.btn.classList.toggle("is-loading", isLoading);
  els.btn.setAttribute("aria-busy", isLoading ? "true" : "false");
  els.btnLabel.textContent = isLoading ? "Consultando" : "Consultar";
}

function scrollToResults() {
  window.setTimeout(() => {
    try {
      els.results.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      els.results.scrollIntoView();
    }
  }, 60);
}

async function consultar(rawCNPJ, options = {}) {
  const { force = false, scroll = true, push = true } = options;
  const cnpj = onlyDigits(rawCNPJ);

  if (!isValidCNPJ(cnpj)) {
    els.box.classList.add("is-invalid");
    validateInput(cnpj);
    els.input.focus();
    return;
  }

  const token = ++requestToken;
  currentCNPJ = cnpj;
  els.input.value = formatCNPJ(cnpj);
  els.box.classList.remove("is-invalid");
  validateInput(cnpj);
  updateURL(cnpj, push);

  const cached = !force ? readCache(cnpj) : null;

  if (cached) {
    setLoading(false);
    renderResult(cached.result, { fromCache: true });
    addRecent(cnpj, cached.result.company.razaoSocial);
    if (scroll) scrollToResults();
    return;
  }

  setLoading(true);
  renderLoading(cnpj);
  if (scroll) scrollToResults();

  try {
    const result = await fetchCompanyData(cnpj, { force });
    if (token !== requestToken) return;
    writeCache(cnpj, result);
    setLoading(false);
    renderResult(result, { fromCache: false });
    addRecent(cnpj, result.company.razaoSocial);
  } catch (error) {
    if (token !== requestToken) return;
    setLoading(false);
    renderError(error, cnpj);
  }
}

function resetView(options = {}) {
  const { updateUrl = true, focus = true, scroll = true } = options;
  requestToken += 1;
  currentCNPJ = null;
  currentResult = null;
  setLoading(false);
  els.results.hidden = true;
  els.results.innerHTML = "";
  els.results.setAttribute("aria-busy", "false");
  els.input.value = "";
  els.box.classList.remove("is-invalid");
  validateInput("");
  if (updateUrl) updateURL(null, true);

  if (scroll) {
    $("#busca").scrollIntoView({ behavior: "smooth", block: "start" });
    if (focus) window.setTimeout(() => els.input.focus({ preventScroll: true }), 450);
  }
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* tenta fallback */ }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------------- events */

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const digits = onlyDigits(els.input.value);

  if (!isValidCNPJ(digits)) {
    els.box.classList.remove("is-invalid");
    void els.box.offsetWidth;
    els.box.classList.add("is-invalid");
    validateInput(digits);
    if (digits.length < 14) setHelp(`Complete os 14 dígitos. Você informou ${digits.length}.`, "error");
    els.input.focus();
    return;
  }

  consultar(digits, { scroll: true, push: true });
});

els.input.addEventListener("input", () => {
  const digits = onlyDigits(els.input.value);
  els.input.value = formatCNPJ(digits);
  els.box.classList.remove("is-invalid");
  validateInput(digits);
});

document.addEventListener("click", async (event) => {
  const chip = event.target.closest(".chip[data-cnpj]");
  if (chip) {
    const cnpj = onlyDigits(chip.dataset.cnpj);
    if (!isValidCNPJ(cnpj)) return;
    els.input.value = formatCNPJ(cnpj);
    validateInput(cnpj);
    consultar(cnpj, { scroll: true, push: true });
    return;
  }

  const copyButton = event.target.closest(".copy-btn[data-copy]");
  if (copyButton) {
    const value = copyButton.dataset.copy || "";
    const ok = await copyToClipboard(value);
    if (!ok) return;
    const original = copyButton.innerHTML;
    copyButton.classList.add("copied");
    copyButton.innerHTML = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3L13 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg> Copiado';
    window.setTimeout(() => {
      if (!copyButton.isConnected) return;
      copyButton.classList.remove("copied");
      copyButton.innerHTML = original;
    }, 1800);
  }
});

els.results.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-action]");
  if (!trigger) return;
  const action = trigger.dataset.action;

  if (action === "new") {
    resetView();
    return;
  }

  if (action === "retry" || action === "refresh") {
    const cnpj = onlyDigits(trigger.dataset.cnpj || currentCNPJ || els.input.value);
    if (isValidCNPJ(cnpj)) consultar(cnpj, { force: true, scroll: false, push: false });
  }
});

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(window.location.search);
  const cnpj = onlyDigits(params.get("cnpj") || "");
  if (isValidCNPJ(cnpj)) {
    consultar(cnpj, { scroll: false, push: false });
  } else {
    resetView({ updateUrl: false, focus: false, scroll: false });
  }
});

/* ---------------------------------------------------------- SEFAZ monitor */

const MONITOR_API = "/api/sefaz-status";
const MONITOR_URL = "https://monitor.tecnospeed.com.br/";
const MONITOR_HISTORY_API = "/api/sefaz-history";
const MONITOR_HISTORY_SEVERITY = {
  3: { label: "Muito lento", tone: "vslow" },
  4: { label: "Sem resposta", tone: "timeout" },
  5: { label: "Erro", tone: "error" },
};

const monitorHistoryState = { data: null, error: null, loading: false };
const monitorHistoryFilters = { period: "7d", document: "all", uf: "all", state: "all" };
const MONITOR_MAP_POSITIONS = {
  AC: [24, 43], RO: [32, 52], AM: [38, 31], RR: [40, 13], AP: [65, 16],
  PA: [60, 35], TO: [61, 51], MA: [70, 43], PI: [77, 49], CE: [85, 39],
  RN: [92, 40], PB: [91, 44], PE: [88, 48], AL: [89, 53], SE: [87, 57],
  BA: [77, 61], MT: [49, 61], MS: [54, 76], GO: [64, 65], DF: [68, 63],
  MG: [77, 70], ES: [84, 73], RJ: [78, 79], SP: [70, 79], PR: [63, 85],
  SC: [64, 91], RS: [59, 96],
};
const MONITOR_DOCS = ["nfe", "nfce", "cte"];
const MONITOR_DOC_LABELS = { nfe: "NF-e", nfce: "NFC-e", cte: "CT-e" };
const MONITOR_STATUS = {
  0: { label: "Agendado", tone: "none", desc: "Aguardando a próxima verificação" },
  1: { label: "Normal", tone: "normal", desc: "Tempo de resposta até 2s" },
  2: { label: "Lento", tone: "slow", desc: "Tempo de resposta até 5s" },
  3: { label: "Muito lento", tone: "vslow", desc: "Tempo de resposta até 30s" },
  4: { label: "Erro", tone: "error", desc: "Retorno com erro" },
  5: { label: "Sem resposta", tone: "timeout", desc: "Timeout acima de 30s" },
};

const MONITOR_MAP_PALETTE = {
  normal: { fill: "#139b70", stroke: "#54e4b2", label: "#f2fff9" },
  slow: { fill: "#d5a43d", stroke: "#ffdc78", label: "#fffaf0" },
  vslow: { fill: "#df793b", stroke: "#ffb476", label: "#fff7f0" },
  timeout: { fill: "#4e7898", stroke: "#94c5e7", label: "#f2f9ff" },
  error: { fill: "#c94757", stroke: "#ff929b", label: "#fff4f5" },
  none: { fill: "#74869a", stroke: "#becbda", label: "#ffffff" },
  unmonitored: { fill: "#536a80", stroke: "#91a6b9", label: "#f5f9fc" },
};

const MONITOR_MISSING = {
  label: "Não monitorado",
  tone: "unmonitored",
  desc: "A fonte não retorna status para este estado/documento",
};

const monitor = {
  data: null,
  loading: false,
  error: null,
  doc: "nfe",
  query: "",
  filter: "all",
  mapUF: null,
};

let currentResult = null;

function monitorStatus(value, present = value != null) {
  if (!present) return MONITOR_MISSING;
  return MONITOR_STATUS[Number(value)] || MONITOR_STATUS[0];
}

function monitorHasState(states, uf) {
  return Object.prototype.hasOwnProperty.call(states, uf) && states[uf] != null;
}

function monitorStateEntries() {
  const states = monitor.data?.docs?.[monitor.doc] || {};
  return Object.keys(SEFAZ)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((uf) => {
      const present = monitorHasState(states, uf);
      return { uf, present, value: present ? Number(states[uf]) : null };
    });
}

function monitorTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function renderMonitorUpdated() {
  const target = $("#monitor-updated");
  if (!target) return;

  if (monitor.loading && !monitor.data) {
    target.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Consultando…</span>';
    return;
  }
  if (!monitor.data) {
    target.innerHTML = '<span class="live-dot" aria-hidden="true" style="background:#9a452f"></span><span>Fonte indisponível</span>';
    return;
  }

  const entries = monitorStateEntries();
  const docLabel = MONITOR_DOC_LABELS[monitor.doc] || monitor.doc.toUpperCase();
  const normal = entries.filter((entry) => entry.present && entry.value === 1).length;
  const alerts = entries.filter((entry) => entry.present && entry.value >= 2 && entry.value <= 5).length;
  const noData = entries.filter((entry) => entry.present && entry.value === 0).length;
  const unmonitored = entries.filter((entry) => !entry.present).length;
  const time = monitorTime(monitor.data.updatedAt);
  const parts = ["<span class=\"live-dot\" aria-hidden=\"true\"></span>", `<span><strong>${docLabel}</strong> · <strong>${normal}</strong> normais · <strong>${alerts}</strong> com alerta`];
  if (noData) parts.push(` · ${noData} sem dados`);
  if (unmonitored) parts.push(` · ${unmonitored} não monitorados`);
  if (time) parts.push(` · atualizado às ${time}`);
  if (monitor.data.errors?.[monitor.doc]) parts.push(" · fonte indisponível");
  if (monitor.data.stale) parts.push(" · dados em cache");
  parts.push("</span>");
  target.innerHTML = parts.join("");
}

function monitorCountsForDocument(doc) {
  const states = monitor.data?.docs?.[doc] || {};
  const ufs = Object.keys(SEFAZ);
  const present = ufs.filter((uf) => monitorHasState(states, uf));
  return {
    total: ufs.length,
    responding: present.filter((uf) => Number(states[uf]) >= 1 && Number(states[uf]) <= 5).length,
    normal: present.filter((uf) => Number(states[uf]) === 1).length,
    alert: present.filter((uf) => Number(states[uf]) >= 2 && Number(states[uf]) <= 5).length,
    noData: ufs.length - present.length + present.filter((uf) => Number(states[uf]) === 0).length,
  };
}

function renderMonitorSummary() {
  const target = $("#monitor-summary");
  if (!target) return;

  target.innerHTML = MONITOR_DOCS.map((doc) => {
    const counts = monitor.data ? monitorCountsForDocument(doc) : { total: 27, responding: 0, normal: 0, alert: 0 };
    const selected = doc === monitor.doc;
    const sourceError = Boolean(monitor.data?.errors?.[doc]);
    let status = monitor.loading ? "Consultando status"
      : !monitor.data ? "Aguardando consulta"
      : sourceError ? "Fonte indisponível"
      : counts.alert ? "Instabilidade detectada"
      : counts.responding < counts.total ? "Dados parciais"
      : "Operando normalmente";
    const tone = !monitor.data || monitor.loading ? "muted"
      : sourceError ? "error"
      : counts.alert ? "alert"
      : counts.responding < counts.total ? "muted"
      : "normal";
    const percent = monitor.data ? Math.round((counts.normal / Math.max(counts.total, 1)) * 100) : 0;

    return `
      <button type="button" class="monitor-summary-card tone-${tone} ${selected ? "is-active" : ""}" data-summary-doc="${doc}" aria-pressed="${selected ? "true" : "false"}">
        <span class="monitor-summary-top">
          <span class="monitor-summary-icon tone-${tone}" aria-hidden="true">${tone === "normal" ? "✓" : tone === "error" || tone === "alert" ? "!" : "…"}</span>
          <span class="monitor-summary-copy">
            <strong>${MONITOR_DOC_LABELS[doc]}</strong>
            <small>${escapeHTML(status)}</small>
          </span>
          <span class="monitor-summary-chevron" aria-hidden="true">↗</span>
        </span>
        <span class="monitor-summary-numbers"><strong>${monitor.data ? counts.normal : "—"}/27 UFs</strong><span>${monitor.data ? `${counts.alert} com alerta` : "cobertura nacional"}</span></span>
        <span class="monitor-summary-progress" aria-hidden="true"><i style="width:${percent}%"></i></span>
      </button>`;
  }).join("");
}

function renderMonitorMapDashboard() {
  const map = $("#monitor-brazil-map");
  const pins = $("#monitor-map-pins");
  const selectedText = $("#monitor-map-selected");
  const serviceList = $("#monitor-map-services");
  const caption = $("#monitor-map-caption");
  if (!map || !pins || !serviceList) return;

  renderMonitorSummary();
  const states = monitor.data?.docs?.[monitor.doc] || {};
  const stateNodes = $$(".monitor-map-state[data-map-uf]", pins);

  stateNodes.forEach((node) => {
    const uf = node.dataset.mapUf;
    const present = Boolean(monitor.data) && monitorHasState(states, uf);
    const value = present ? Number(states[uf]) : null;
    const info = monitorStatus(value, present);
    const selected = monitor.mapUF === uf;
    const palette = MONITOR_MAP_PALETTE[info.tone] || MONITOR_MAP_PALETTE.unmonitored;
    const statePaths = $("path", node);
    const stateText = $("text", node);
    node.classList.remove("tone-normal", "tone-slow", "tone-vslow", "tone-timeout", "tone-error", "tone-none", "tone-unmonitored");
    node.classList.add(`tone-${info.tone}`);
    node.classList.toggle("is-selected", selected);
    node.style.cursor = "pointer";
    node.setAttribute("aria-pressed", selected ? "true" : "false");
    node.setAttribute("aria-label", `${node.dataset.mapName || SEFAZ[uf]?.name || uf} (${uf}): ${info.label}`);
    node.setAttribute("title", `${node.dataset.mapName || SEFAZ[uf]?.name || uf} · ${info.label}`);
    // Algumas UFs usam um caminho adicional para representar áreas pequenas no mapa.
    // Todos os caminhos dentro do grupo recebem a cor do mesmo status/documento.
    statePaths.forEach((statePath) => {
      statePath.style.setProperty("fill", palette.fill, "important");
      statePath.style.setProperty("stroke", selected ? "#e9fff7" : palette.stroke, "important");
      statePath.style.setProperty("stroke-width", selected ? "2.5" : "1.1", "important");
      statePath.style.setProperty("pointer-events", "visiblePainted", "important");
      statePath.style.setProperty("cursor", "pointer", "important");
      if (selected) {
        statePath.style.setProperty("filter", `drop-shadow(0 0 6px ${palette.stroke}88)`, "important");
      } else {
        statePath.style.removeProperty("filter");
      }
    });
    if (stateText) {
      stateText.style.setProperty("pointer-events", "none", "important");
      stateText.style.setProperty("user-select", "none", "important");
      stateText.style.setProperty("fill", "#f4f8fc", "important");
    }
  });

  if (caption) {
    caption.textContent = monitor.mapUF
      ? `UF selecionada: ${SEFAZ[monitor.mapUF]?.name || monitor.mapUF}. Clique em outro estado para trocar.`
      : `Situação de ${MONITOR_DOC_LABELS[monitor.doc]} por UF. Selecione um estado para filtrar a grade abaixo.`;
  }
  if (selectedText) {
    if (monitor.mapUF) {
      const uf = monitor.mapUF;
      const present = Boolean(monitor.data) && monitorHasState(states, uf);
      const info = monitorStatus(present ? Number(states[uf]) : null, present);
      selectedText.innerHTML = `<strong>${escapeHTML(SEFAZ[uf]?.name || uf)} (${uf})</strong><span class="monitor-map-selected-status tone-${info.tone}">${escapeHTML(info.label)}</span>`;
    } else {
      selectedText.textContent = monitor.data
        ? "Selecione um estado no mapa para filtrar por UF."
        : "Aguardando a primeira leitura do Monitor SEFAZ.";
    }
  }

  const alertTarget = $("#monitor-map-alert");
  const incidentList = Array.isArray(monitorHistoryState.data?.incidents) ? monitorHistoryState.data.incidents : [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const recentIncidents = incidentList.filter((incident) => {
    const detected = new Date(incident?.detectedAt || "").getTime();
    return MONITOR_DOCS.includes(incident?.document) && /^[A-Z]{2}$/.test(String(incident?.uf || "")) && Number.isFinite(detected) && detected >= cutoff;
  });
  const activeIncidents = recentIncidents.filter((incident) => !incident.recoveredAt).length;
  if (alertTarget) {
    if (!monitorHistoryState.data) {
      alertTarget.className = "monitor-map-alert is-neutral";
      alertTarget.innerHTML = '<span class="monitor-map-alert-icon" aria-hidden="true">i</span><div><strong>Histórico de ocorrências</strong><p>Carregando os incidentes registrados nas últimas 24 horas.</p></div><a href="#monitor-history">Ver histórico</a>';
    } else if (recentIncidents.length) {
      alertTarget.className = "monitor-map-alert is-alert";
      alertTarget.innerHTML = `<span class="monitor-map-alert-icon" aria-hidden="true">!</span><div><strong>${recentIncidents.length} ocorrência(s) nas últimas 24 horas</strong><p>${activeIncidents ? `${activeIncidents} ainda em andamento` : "Todas as ocorrências registradas nesse período estão normalizadas"}.</p></div><a href="#monitor-history">Ver histórico</a>`;
    } else {
      alertTarget.className = "monitor-map-alert is-ok";
      alertTarget.innerHTML = '<span class="monitor-map-alert-icon" aria-hidden="true">✓</span><div><strong>Nenhuma instabilidade severa registrada</strong><p>Não há incidentes registrados nas últimas 24 horas de coleta.</p></div><a href="#monitor-history">Ver histórico</a>';
    }
  }

  if (!monitor.data) {
    serviceList.innerHTML = '<div class="monitor-map-service-empty">Consultando o status atual dos serviços…</div>';
    return;
  }

  serviceList.innerHTML = MONITOR_DOCS.map((doc) => {
    const counts = monitorCountsForDocument(doc);
    const active = doc === monitor.doc;
    const docError = Boolean(monitor.data.errors?.[doc]);
    const updatedStatus = docError ? "Fonte indisponível"
      : monitor.data.stale ? "Dados em cache"
      : counts.alert ? "Atenção necessária"
      : counts.responding < 27 ? "Dados parciais"
      : "Operando normalmente";
    const operationTone = docError ? "error"
      : counts.alert ? "alert"
      : counts.responding < 27 ? "muted"
      : "normal";
    return `
      <button type="button" class="monitor-map-service ${active ? "is-active" : ""}" data-map-doc="${doc}" aria-pressed="${active ? "true" : "false"}">
        <span class="monitor-map-service-top">
          <strong>${MONITOR_DOC_LABELS[doc]}</strong>
          <span class="monitor-map-service-state tone-${operationTone}"><i aria-hidden="true"></i>${escapeHTML(updatedStatus)}</span>
        </span>
        <span class="monitor-map-service-counts">
          <span><strong>${counts.normal}</strong> normais</span>
          <span><strong>${counts.alert}</strong> alertas</span>
          <span><strong>${counts.responding}/27</strong> com status</span>
        </span>
        <span class="monitor-map-service-bar" aria-hidden="true"><i style="width:${Math.round((counts.normal / Math.max(counts.total, 1)) * 100)}%"></i></span>
      </button>`;
  }).join("");
}

function renderMonitorControls() {
  $$(".monitor-filter-btn").forEach((button) => {
    const active = button.dataset.filter === monitor.filter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const refresh = $("#monitor-refresh");
  if (refresh) {
    refresh.disabled = monitor.loading;
    refresh.classList.toggle("is-loading", monitor.loading);
    refresh.setAttribute("aria-busy", monitor.loading ? "true" : "false");
  }
}

function filteredMonitorEntries() {
  const entries = monitorStateEntries();
  const query = monitor.query.trim().toLowerCase();
  const selectedUF = monitor.mapUF && Object.prototype.hasOwnProperty.call(SEFAZ, monitor.mapUF)
    ? monitor.mapUF
    : null;

  return entries.filter((entry) => {
    // O clique no mapa deve filtrar pela UF exata, não por trechos do nome.
    // Ex.: "TO" não pode incluir "Distrito Federal", "Espírito Santo" ou "Mato Grosso".
    if (selectedUF && entry.uf !== selectedUF) return false;

    // A busca textual continua aceitando sigla ou parte do nome digitado.
    if (query && !selectedUF) {
      const name = SEFAZ[entry.uf]?.name || entry.uf;
      if (!entry.uf.toLowerCase().includes(query) && !name.toLowerCase().includes(query)) return false;
    }

    if (monitor.filter === "alert") {
      return entry.present && entry.value >= 2 && entry.value <= 5;
    }
    return true;
  });
}

function renderMonitor() {
  const grid = $("#monitor-grid");
  if (!grid) return;

  $$(".monitor-tab").forEach((tab) => {
    const selected = tab.dataset.doc === monitor.doc;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.setAttribute("tabindex", selected ? "0" : "-1");
  });
  grid.setAttribute("aria-labelledby", `tab-${monitor.doc}`);
  renderMonitorUpdated();
  renderMonitorControls();
  renderMonitorMapDashboard();

  if (!monitor.data && monitor.loading) {
    grid.innerHTML = Object.keys(SEFAZ).sort((a, b) => a.localeCompare(b, "pt-BR")).map(() => `
      <div class="monitor-state is-loading" aria-hidden="true">
        <span class="sk"></span>
        <span class="sk"></span>
      </div>`).join("");
    return;
  }

  if (!monitor.data && monitor.error) {
    grid.innerHTML = `
      <div class="monitor-error">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 6v5M10 14v.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.4"/></svg>
        <div>
          <strong>Não foi possível carregar o monitor agora.</strong>
          O serviço de status da TecnoSpeed não respondeu. Tente novamente ou abra o monitor diretamente.
          <div class="notice-actions">
            <button class="btn btn--outline btn--sm" type="button" data-action="monitor-retry">Tentar novamente</button>
            <a class="btn btn--solid btn--sm" href="${MONITOR_URL}" target="_blank" rel="noopener noreferrer">Abrir Monitor SEFAZ</a>
          </div>
        </div>
      </div>`;
    return;
  }

  const entries = filteredMonitorEntries();
  if (!entries.length) {
    grid.innerHTML = `
      <div class="monitor-empty">
        <strong>Nenhum estado encontrado.</strong>
        <span>Ajuste a busca ou o filtro para ver mais estados.</span>
        <button type="button" data-action="monitor-clear">Limpar filtros</button>
      </div>`;
    return;
  }

  const states = monitor.data?.docs?.[monitor.doc] || {};
  grid.innerHTML = entries.map(({ uf, present }) => {
    const info = monitorStatus(states[uf], present);
    const name = SEFAZ[uf]?.name || uf;
    return `
      <div class="monitor-state tone-${info.tone}" title="${escapeHTML(name)} · ${MONITOR_DOC_LABELS[monitor.doc]}: ${info.label} (${info.desc})">
        <span class="uf">${uf}</span>
        <span class="status"><i aria-hidden="true"></i>${info.label}</span>
      </div>`;
  }).join("");
}

function selectMonitorDoc(doc) {
  if (!MONITOR_DOCS.includes(doc)) return;
  if (doc === monitor.doc) {
    renderMonitor();
    return;
  }
  monitor.doc = doc;
  renderMonitor();
}

async function loadMonitor(force = false) {
  if (monitor.loading) return;
  monitor.loading = true;
  monitor.error = null;
  renderMonitor();

  try {
    const response = await fetch(`${MONITOR_API}${force ? "?force=1" : ""}`, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.detail || body?.error || "";
      } catch { /* resposta sem JSON */ }
      throw new Error(detail || `HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data?.docs || typeof data.docs !== "object") throw new Error("Resposta inválida do monitor");
    monitor.data = data;
  } catch (error) {
    monitor.error = error;
  } finally {
    monitor.loading = false;
    renderMonitor();
    renderResultServices();
  }
}

/* ------------------------------------------------- SEFAZ status in result */

function monitorHistoryDate(value) {
  if (!value) return "Horário não informado";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Horário não informado";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function monitorHistoryDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return "menos de 1 minuto";
  const minutes = Math.floor(total / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
  return `${minutes} min`;
}

function ensureMonitorHistoryUFOptions() {
  const select = $("#monitor-history-uf");
  if (!select || select.dataset.ready === "true") return;
  const options = Object.keys(SEFAZ)
    .sort((a, b) => a.localeCompare(b, "pt-BR"))
    .map((uf) => `<option value="${escapeHTML(uf)}">${escapeHTML(uf)} — ${escapeHTML(SEFAZ[uf]?.name || uf)}</option>`)
    .join("");
  select.insertAdjacentHTML("beforeend", options);
  select.dataset.ready = "true";
}

function monitorHistoryWindow(period, now = Date.now()) {
  const duration = period === "24h" ? 24 * 60 * 60 * 1000 : period === "30d" ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return { start: now - duration, end: now, duration };
}

function filteredMonitorHistoryIncidents() {
  const source = Array.isArray(monitorHistoryState.data?.incidents) ? monitorHistoryState.data.incidents : [];
  const { start, end } = monitorHistoryWindow(monitorHistoryFilters.period);
  return source
    .filter((incident) => {
      if (!incident || !MONITOR_DOCS.includes(incident.document) || !/^[A-Z]{2}$/.test(String(incident.uf || ""))) return false;
      const detectedAt = new Date(incident.detectedAt || "").getTime();
      if (!Number.isFinite(detectedAt) || detectedAt < start || detectedAt > end) return false;
      if (monitorHistoryFilters.document !== "all" && incident.document !== monitorHistoryFilters.document) return false;
      if (monitorHistoryFilters.uf !== "all" && incident.uf !== monitorHistoryFilters.uf) return false;
      const active = !incident.recoveredAt;
      if (monitorHistoryFilters.state === "open" && !active) return false;
      if (monitorHistoryFilters.state === "resolved" && active) return false;
      return true;
    })
    .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime());
}

function renderMonitorHistoryChart(incidents) {
  const chart = $("#monitor-history-chart");
  const title = $("#monitor-history-chart-title");
  const description = $("#monitor-history-chart-description");
  if (!chart) return;

  const now = Date.now();
  const { start } = monitorHistoryWindow(monitorHistoryFilters.period, now);
  const hourMode = monitorHistoryFilters.period === "24h";
  const bucketCount = hourMode ? 25 : monitorHistoryFilters.period === "30d" ? 31 : 8;
  const buckets = [];
  if (hourMode) {
    const startHour = new Date(start);
    startHour.setMinutes(0, 0, 0);
    for (let i = 0; i < bucketCount; i += 1) {
      const date = new Date(startHour.getTime() + i * 60 * 60 * 1000);
      buckets.push({ key: date.toISOString().slice(0, 13), label: date.toLocaleTimeString("pt-BR", { hour: "2-digit" }), count: 0 });
    }
  } else {
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    for (let i = 0; i < bucketCount; i += 1) {
      const date = new Date(startDay.getTime() + i * 24 * 60 * 60 * 1000);
      buckets.push({ key: date.toISOString().slice(0, 10), label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), count: 0 });
    }
  }

  incidents.forEach((incident) => {
    const detectedAt = new Date(incident.detectedAt || "");
    if (Number.isNaN(detectedAt.getTime())) return;
    const key = hourMode ? detectedAt.toISOString().slice(0, 13) : detectedAt.toISOString().slice(0, 10);
    const bucket = buckets.find((item) => item.key === key);
    if (bucket) bucket.count += 1;
  });

  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  if (title) title.textContent = hourMode ? "Ocorrências por hora" : "Ocorrências por dia";
  if (description) description.textContent = `Incidentes detectados · ${MONITOR_DOC_LABELS[monitorHistoryFilters.document] || "todos os documentos"}`;
  chart.style.gridTemplateColumns = `repeat(${buckets.length}, minmax(0, 1fr))`;
  chart.innerHTML = buckets.map((bucket) => {
    const height = bucket.count ? Math.max(8, Math.round((bucket.count / max) * 100)) : 2;
    return `
      <div class="monitor-chart-column" title="${escapeHTML(bucket.label)}: ${bucket.count} ocorrência(s)">
        <div class="monitor-chart-bar-track"><i class="${bucket.count ? "has-data" : ""}" style="height:${height}%"></i></div>
        <span>${escapeHTML(bucket.label)}</span>
        <small>${bucket.count}</small>
      </div>`;
  }).join("");
}

function renderMonitorHistory() {
  const list = $("#monitor-history-list");
  const status = $("#monitor-history-status");
  const note = $("#monitor-history-note");
  const summary = $("#monitor-history-summary");
  const resultsCount = $("#monitor-history-results-count");
  if (!list || !status) return;
  ensureMonitorHistoryUFOptions();

  $$("[data-history-period]").forEach((button) => {
    const active = button.dataset.historyPeriod === monitorHistoryFilters.period;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const documentSelect = $("#monitor-history-document");
  const ufSelect = $("#monitor-history-uf");
  const stateSelect = $("#monitor-history-state");
  if (documentSelect) documentSelect.value = monitorHistoryFilters.document;
  if (ufSelect) ufSelect.value = monitorHistoryFilters.uf;
  if (stateSelect) stateSelect.value = monitorHistoryFilters.state;

  const data = monitorHistoryState.data;
  if (monitorHistoryState.loading && !data) {
    status.textContent = "Consultando histórico…";
    list.innerHTML = '<div class="monitor-history-empty">Buscando as primeiras ocorrências registradas…</div>';
    if (summary) summary.innerHTML = "";
    if ($("#monitor-history-chart")) $("#monitor-history-chart").innerHTML = '<div class="monitor-history-chart-empty">Carregando gráfico…</div>';
    return;
  }

  if (!data && monitorHistoryState.error) {
    status.textContent = "Histórico temporariamente indisponível";
    list.innerHTML = `
      <div class="monitor-history-empty">
        <strong>Não foi possível carregar o histórico agora.</strong>
        Tente novamente em instantes ou consulte o monitor original da TecnoSpeed.
        <div><button class="monitor-history-retry" type="button" data-action="monitor-history-retry">Tentar novamente</button></div>
      </div>`;
    if (summary) summary.innerHTML = "";
    if ($("#monitor-history-chart")) $("#monitor-history-chart").innerHTML = '<div class="monitor-history-chart-empty">Não foi possível montar o gráfico sem dados.</div>';
    return;
  }
  if (!data) return;

  const allIncidents = (Array.isArray(data.incidents) ? data.incidents : [])
    .filter((incident) => incident && MONITOR_DOCS.includes(incident.document) && /^[A-Z]{2}$/.test(String(incident.uf || "")));
  const incidents = filteredMonitorHistoryIncidents();
  const activeCount = incidents.filter((incident) => !incident.recoveredAt).length;
  const resolvedCount = incidents.length - activeCount;
  const durationSeconds = incidents.reduce((sum, incident) => sum + (Number(incident.durationSeconds) > 0 ? Number(incident.durationSeconds) : 0), 0);
  const formattedDuration = monitorHistoryDuration(durationSeconds);

  status.textContent = data.stale ? "Último histórico disponível · cache" : "Coleta automática · cerca de 5 min";
  if (note && data.trackingSince) {
    note.textContent = `Coleta ativa desde ${monitorHistoryDate(data.trackingSince)}. O histórico não recupera ocorrências anteriores à ativação; falhas muito curtas entre as coletas podem não aparecer.`;
  }

  if (summary) {
    summary.innerHTML = [
      { label: "Ocorrências", value: incidents.length, tone: "neutral" },
      { label: "Em andamento", value: activeCount, tone: activeCount ? "alert" : "normal" },
      { label: "Normalizadas", value: resolvedCount, tone: "normal" },
      { label: "Duração observada", value: formattedDuration, tone: "neutral" },
    ].map((item) => `<div class="monitor-history-metric tone-${item.tone}"><span>${escapeHTML(item.label)}</span><strong>${escapeHTML(String(item.value))}</strong></div>`).join("");
  }
  renderMonitorHistoryChart(incidents);
  if (resultsCount) resultsCount.textContent = `${incidents.length} ocorrência(s) no filtro atual`;

  if (!allIncidents.length) {
    list.innerHTML = `
      <div class="monitor-history-empty">
        <strong>Nenhuma instabilidade severa registrada ainda.</strong>
        As primeiras ocorrências aparecerão aqui quando a coleta observar um serviço em estado Muito lento, Sem resposta ou Erro.
      </div>`;
    return;
  }

  if (!incidents.length) {
    list.innerHTML = `
      <div class="monitor-history-empty">
        <strong>Nenhuma ocorrência encontrada para estes filtros.</strong>
        Tente ampliar o período ou limpar algum filtro.
      </div>`;
    return;
  }

  list.innerHTML = incidents.slice(0, 50).map((incident) => {
    const documentLabel = MONITOR_DOC_LABELS[incident.document] || String(incident.document || "").toUpperCase();
    const uf = String(incident.uf).toUpperCase();
    const stateName = SEFAZ[uf]?.name || uf;
    const active = !incident.recoveredAt;
    const severity = MONITOR_HISTORY_SEVERITY[Number(incident.maxSeverity)] || { label: "Instabilidade", tone: "none" };
    const detected = monitorHistoryDate(incident.detectedAt);
    const recovered = incident.recoveredAt ? monitorHistoryDate(incident.recoveredAt) : "";
    const duration = incident.recoveredAt && Number.isFinite(Number(incident.durationSeconds))
      ? monitorHistoryDuration(incident.durationSeconds)
      : "";
    return `
      <article class="monitor-history-item" role="listitem">
        <div class="monitor-history-main">
          <div class="monitor-history-title">
            <span>${escapeHTML(documentLabel)} · ${escapeHTML(uf)} — ${escapeHTML(stateName)}</span>
            <span class="monitor-history-severity tone-${severity.tone}">${escapeHTML(severity.label)} · pico</span>
          </div>
          <div class="monitor-history-meta">
            <span>Primeira detecção: ${escapeHTML(detected)}</span>
            ${recovered ? `<span>Normalizado: ${escapeHTML(recovered)}</span>` : "<span>Sem normalização confirmada</span>"}
          </div>
          ${duration ? `<div class="monitor-history-duration">Tempo observado até normalizar: ${escapeHTML(duration)}</div>` : ""}
        </div>
        <span class="monitor-history-state ${active ? "is-open" : "is-resolved"}">${active ? "Em andamento" : "Normalizado"}</span>
      </article>`;
  }).join("");
}

async function loadMonitorHistory(force = false) {
  if (monitorHistoryState.loading) return;
  monitorHistoryState.loading = true;
  monitorHistoryState.error = null;
  renderMonitorHistory();

  try {
    const response = await fetch(`${MONITOR_HISTORY_API}${force ? "?force=1" : ""}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body?.detail || body?.error || "";
      } catch { /* resposta sem JSON */ }
      throw new Error(detail || `HTTP ${response.status}`);
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.incidents)) throw new Error("Resposta inválida do histórico");
    monitorHistoryState.data = data;
    monitorHistoryState.error = null;
  } catch (error) {
    monitorHistoryState.error = error;
  } finally {
    monitorHistoryState.loading = false;
    renderMonitorHistory();
    renderMonitorMapDashboard();
  }
}

function companyStates(result) {
  const map = new Map();
  (result.ies || []).forEach((ie) => {
    const uf = String(ie.uf || "").toUpperCase();
    if (/^[A-Z]{2}$/.test(uf) && !map.has(uf)) map.set(uf, ie.estado || ufName(uf));
  });
  const companyUF = String(result.company?.uf || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(companyUF) && !map.has(companyUF)) {
    map.set(companyUF, ufName(companyUF));
  }
  return [...map.entries()]
    .map(([uf, name]) => ({ uf, name }))
    .sort((a, b) => a.uf.localeCompare(b.uf, "pt-BR"));
}

function renderServiceRows(result) {
  const states = companyStates(result);
  if (!states.length) {
    return '<div class="service-loading">Nenhum estado vinculado a esta empresa para consultar.</div>';
  }
  if (!monitor.data && monitor.loading) {
    return '<div class="service-loading"><span class="spinner-dark" aria-hidden="true"></span>Consultando o status dos serviços fiscais…</div>';
  }
  if (!monitor.data) {
    return `<div class="service-error">Não foi possível carregar os status agora. <a href="${MONITOR_URL}" target="_blank" rel="noopener noreferrer">Abrir o Monitor SEFAZ</a>.</div>`;
  }

  return states.map((state) => {
    const docs = MONITOR_DOCS.map((doc) => {
      const values = monitor.data.docs?.[doc] || {};
      const present = monitorHasState(values, state.uf);
      const info = monitorStatus(values[state.uf], present);
      return `
        <span class="doc-chip tone-${info.tone}" title="${MONITOR_DOC_LABELS[doc]} em ${escapeHTML(state.name)}: ${info.label} (${info.desc})">
          <span class="doc-name">${MONITOR_DOC_LABELS[doc]}</span>
          <span class="doc-state"><i aria-hidden="true"></i>${info.label}</span>
        </span>`;
    }).join("");

    return `
      <div class="service-row">
        <div class="service-state">
          <span class="uf-seal uf-seal--sm" aria-hidden="true">${escapeHTML(state.uf)}</span>
          <div>
            <strong>${escapeHTML(state.name)}</strong>
            <span>Monitor SEFAZ · TecnoSpeed</span>
          </div>
        </div>
        <div class="service-docs">${docs}</div>
      </div>`;
  }).join("");
}

function renderResultServices() {
  const host = $("[data-services]");
  if (!host || !currentResult) return;
  host.innerHTML = renderServiceRows(currentResult);
}

$$(".monitor-tab").forEach((tab) => {
  tab.addEventListener("click", () => selectMonitorDoc(tab.dataset.doc));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const tabs = $$(".monitor-tab");
    const index = tabs.indexOf(tab);
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + direction + tabs.length) % tabs.length];
    next.focus();
    selectMonitorDoc(next.dataset.doc);
  });
});

$("#monitor-search")?.addEventListener("input", (event) => {
  monitor.query = event.target.value;
  monitor.mapUF = null;
  renderMonitor();
});

$$(".monitor-filter-btn").forEach((button) => {
  button.addEventListener("click", () => {
    monitor.filter = button.dataset.filter === "alert" ? "alert" : "all";
    renderMonitor();
  });
});

$("#monitor-refresh")?.addEventListener("click", () => loadMonitor(true));

$("#monitor-map-pins")?.addEventListener("click", (event) => {
  const state = event.target.closest(".monitor-map-state[data-map-uf]");
  if (!state || !event.target.closest("path")) return;
  const uf = state.dataset.mapUf;
  if (!SEFAZ[uf]) return;
  monitor.mapUF = uf;
  monitor.query = uf;
  monitor.filter = "all";
  const search = $("#monitor-search");
  if (search) search.value = uf;
  renderMonitor();
  $("#monitor-grid")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

$("#monitor-map-pins")?.addEventListener("keydown", (event) => {
  const state = event.target.closest(".monitor-map-state[data-map-uf]");
  if (state && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    state.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return;
  }
  if (event.key !== "Escape") return;
  monitor.mapUF = null;
  if (monitor.query && SEFAZ[monitor.query.toUpperCase()]) {
    monitor.query = "";
    const search = $("#monitor-search");
    if (search) search.value = "";
  }
  renderMonitor();
});

$("[data-map-reset]")?.addEventListener("click", () => {
  if (monitor.mapUF && monitor.query === monitor.mapUF) {
    monitor.query = "";
    const search = $("#monitor-search");
    if (search) search.value = "";
  }
  monitor.mapUF = null;
  renderMonitor();
});

$("#monitor-summary")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-summary-doc]");
  if (!button) return;
  selectMonitorDoc(button.dataset.summaryDoc);
});

$("#monitor-map-services")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-map-doc]");
  if (!button) return;
  selectMonitorDoc(button.dataset.mapDoc);
});

$$("[data-history-period]").forEach((button) => {
  button.addEventListener("click", () => {
    monitorHistoryFilters.period = ["24h", "7d", "30d"].includes(button.dataset.historyPeriod) ? button.dataset.historyPeriod : "7d";
    renderMonitorHistory();
  });
});

$("#monitor-history-document")?.addEventListener("change", (event) => {
  monitorHistoryFilters.document = ["all", ...MONITOR_DOCS].includes(event.target.value) ? event.target.value : "all";
  renderMonitorHistory();
});

$("#monitor-history-uf")?.addEventListener("change", (event) => {
  const value = event.target.value;
  monitorHistoryFilters.uf = value === "all" || Object.prototype.hasOwnProperty.call(SEFAZ, value) ? value : "all";
  renderMonitorHistory();
});

$("#monitor-history-state")?.addEventListener("change", (event) => {
  monitorHistoryFilters.state = ["all", "open", "resolved"].includes(event.target.value) ? event.target.value : "all";
  renderMonitorHistory();
});

$("[data-history-reset]")?.addEventListener("click", () => {
  monitorHistoryFilters.period = "7d";
  monitorHistoryFilters.document = "all";
  monitorHistoryFilters.uf = "all";
  monitorHistoryFilters.state = "all";
  renderMonitorHistory();
});

$("#monitor-history-list")?.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="monitor-history-retry"]')) loadMonitorHistory(true);
});

$("#monitor-grid")?.addEventListener("click", (event) => {
  if (event.target.closest('[data-action="monitor-retry"]')) {
    loadMonitor(true);
    return;
  }
  if (event.target.closest('[data-action="monitor-clear"]')) {
    monitor.query = "";
    monitor.filter = "all";
    const search = $("#monitor-search");
    if (search) search.value = "";
    renderMonitor();
  }
});

/* -------------------------------------------------------------------- init */

function initTheme() {
  const root = document.documentElement;
  const toggle = $("#theme-toggle");
  const meta = document.querySelector('meta[name="theme-color"]');
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  const applyTheme = (theme, persist = false) => {
    const dark = theme === "dark";
    root.dataset.theme = dark ? "dark" : "light";
    if (persist) safeStore(THEME_KEY, root.dataset.theme);
    if (toggle) {
      toggle.setAttribute("aria-pressed", dark ? "true" : "false");
      toggle.setAttribute("aria-label", dark ? "Ativar modo claro" : "Ativar modo escuro");
      toggle.title = dark ? "Ativar modo claro" : "Ativar modo escuro";
    }
    if (meta) meta.setAttribute("content", dark ? "#070F0B" : "#0A1F17");
  };

  applyTheme(root.dataset.theme === "dark" ? "dark" : "light");

  toggle?.addEventListener("click", () => {
    applyTheme(root.dataset.theme === "dark" ? "light" : "dark", true);
  });

  const onSystemChange = (event) => {
    if (safeRead(THEME_KEY)) return;
    applyTheme(event.matches ? "dark" : "light");
  };

  if (media) {
    if (typeof media.addEventListener === "function") media.addEventListener("change", onSystemChange);
    else if (typeof media.addListener === "function") media.addListener(onSystemChange);
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_KEY) return;
    if (event.newValue === "dark" || event.newValue === "light") applyTheme(event.newValue);
  });
}

function initMobileMenu() {
  const header = $(".site-header");
  const toggle = $("#menu-toggle");
  const menu = $("#mobile-menu");
  if (!header || !toggle || !menu) return;

  const setOpen = (open, restoreFocus = false) => {
    const wasOpen = !menu.hidden;
    menu.hidden = !open;
    header.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Fechar menu" : "Abrir menu");

    if (open) {
      const first = menu.querySelector("a");
      if (first) first.focus({ preventScroll: true });
    } else if (restoreFocus && wasOpen) {
      toggle.focus({ preventScroll: true });
    }
  };

  toggle.addEventListener("click", () => {
    setOpen(menu.hidden, !menu.hidden);
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", (event) => {
    if (menu.hidden || header.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.hidden) return;
    event.preventDefault();
    setOpen(false, true);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900 && !menu.hidden) setOpen(false);
  });
}

function initReveal() {
  const elements = $$("[data-reveal]");
  if (!elements.length) return;
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -30px 0px" });
  elements.forEach((element) => observer.observe(element));
}

function init() {
  $("#ano").textContent = new Date().getFullYear();
  renderPortalGrid();
  renderRecents();
  initTheme();
  initMobileMenu();
  initReveal();
  validateInput("");
  renderMonitor();
  loadMonitor();
  loadMonitorHistory();
  setInterval(() => {
    if (!document.hidden) loadMonitor();
  }, 60_000);
  setInterval(() => {
    if (!document.hidden) loadMonitorHistory();
  }, 120_000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      loadMonitor();
      loadMonitorHistory();
    }
  });

  const params = new URLSearchParams(window.location.search);
  const initialCNPJ = onlyDigits(params.get("cnpj") || "");
  if (isValidCNPJ(initialCNPJ)) {
    els.input.value = formatCNPJ(initialCNPJ);
    validateInput(initialCNPJ);
    consultar(initialCNPJ, { scroll: false, push: false });
  }
}

init();
