"use strict";

// Adaptação oficial Consulta CPF v3 — Serpro.
// NÃO disponibilizar consultas pagas a visitantes sem controle de acesso e contrato.
const crypto = require("node:crypto");
const TOKEN_URL = "https://gateway.apiserpro.serpro.gov.br/token";
const CPF_URL = "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/";

function validCpf(value) {
  const cpf = String(value || "").replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let index = 9; index < 11; index++) {
    let sum = 0;
    for (let i = 0; i < index; i++) sum += Number(cpf[i]) * (index + 1 - i);
    const digit = sum * 10 % 11;
    if ((digit === 10 ? 0 : digit) !== Number(cpf[index])) return false;
  }
  return true;
}
function birthToSerpro(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || date > new Date() || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return String(day).padStart(2, "0") + String(month).padStart(2, "0") + String(year);
}
function sameSecret(input, configured) {
  if (typeof input !== "string" || typeof configured !== "string" || !configured || input.length > 256) return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(configured).digest();
  return crypto.timingSafeEqual(a, b);
}
class CpfSourceError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
function createSerproCpfClient({ env = process.env, fetchFn = globalThis.fetch, now = () => Date.now() } = {}) {
  let token = null;
  let expiresAt = 0;
  let pendingToken = null;
  function configured() {
    return env.CPF_SERPRO_ENABLED === "1"
      && Boolean(env.SERPRO_CONSUMER_KEY)
      && Boolean(env.SERPRO_CONSUMER_SECRET)
      && typeof env.CPF_OPERATOR_KEY === "string"
      && env.CPF_OPERATOR_KEY.length >= 32;
  }
  function authorized(value) {
    return configured() && sameSecret(value, env.CPF_OPERATOR_KEY);
  }
  async function postToken() {
    const basic = Buffer.from(env.SERPRO_CONSUMER_KEY + ":" + env.SERPRO_CONSUMER_SECRET).toString("base64");
    let response;
    try {
      response = await fetchFn(TOKEN_URL, {
        method: "POST",
        headers: {
          "Authorization": "Basic " + basic,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(8500),
        redirect: "error",
      });
    } catch {
      throw new CpfSourceError("upstream_unavailable", 502, "O serviço do Serpro não respondeu.");
    }
    if (!response.ok) throw new CpfSourceError("provider_auth", 502, "A autenticação contratual no Serpro falhou.");
    let data;
    try { data = await response.json(); } catch { throw new CpfSourceError("upstream_invalid", 502, "Resposta inválida do Serpro."); }
    if (typeof data.access_token !== "string" || !data.access_token) throw new CpfSourceError("upstream_invalid", 502, "Token não retornado pelo Serpro.");
    token = data.access_token;
    expiresAt = now() + Math.max(60, Math.min(Number(data.expires_in) || 3300, 3600) - 90) * 1000;
    return token;
  }
  async function getToken() {
    if (token && now() < expiresAt) return token;
    if (!pendingToken) {
      pendingToken = postToken().finally(() => { pendingToken = null; });
    }
    return pendingToken;
  }
  async function lookup(cpf, birth) {
    if (!configured()) throw new CpfSourceError("not_configured", 503, "Integração desativada.");
    const id = String(cpf || "").replace(/\D/g, "");
    const born = birthToSerpro(birth);
    if (!validCpf(id) || !born) throw new CpfSourceError("invalid_input", 400, "CPF ou data de nascimento inválidos.");
    const accessToken = await getToken();
    let response;
    try {
      response = await fetchFn(CPF_URL + id + "/" + born, {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + accessToken,
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
    } catch {
      throw new CpfSourceError("upstream_unavailable", 502, "A consulta ao Serpro não respondeu.");
    }
    if (response.status === 401 || response.status === 403) {
      token = null; expiresAt = 0;
      throw new CpfSourceError("provider_auth", 502, "O Serpro rejeitou o acesso contratado.");
    }
    if (response.status === 404) {
      throw new CpfSourceError("not_found", 404, "CPF ou data de nascimento não correspondem à fonte oficial.");
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new CpfSourceError("upstream_unavailable", 502, "O Serpro não conseguiu concluir a consulta.");
    }
    let data;
    try { data = await response.json(); } catch { throw new CpfSourceError("upstream_invalid", 502, "Resposta inválida do Serpro."); }
    if (!data || typeof data !== "object" || typeof data.nome !== "string") {
      throw new CpfSourceError("upstream_invalid", 502, "A fonte não retornou informações cadastrais reconhecíveis.");
    }
    // Somente campos públicos do contrato explicitamente usados; sem endereço/telefone.
    return {
      nome: data.nome,
      nomeSocial: typeof data.nomeSocial === "string" ? data.nomeSocial : null,
      situacao: data.situacao && typeof data.situacao.descricao === "string" ? data.situacao.descricao : "Não informada",
      dataInscricao: /^\d{8}$/.test(String(data.dataInscricao || "")) ? data.dataInscricao : null,
      parcial: response.status === 206,
      fonte: "Serpro / Receita Federal — Consulta CPF v3",
      consultadoEm: new Date(now()).toISOString(),
    };
  }
  return { configured, authorized, lookup };
}

module.exports = { createSerproCpfClient, validCpf, birthToSerpro, sameSecret, CpfSourceError };
