"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSerproCpfClient, validCpf, birthToSerpro } = require("../serpro-cpf");

const ENV = {
  CPF_SERPRO_ENABLED: "1",
  CPF_OPERATOR_KEY: "test-operator-access-key-is-at-least-32-chars",
  SERPRO_CONSUMER_KEY: "demo-key",
  SERPRO_CONSUMER_SECRET: "demo-secret",
};

test("validação de CPF e data de nascimento antes da API", () => {
  assert.equal(validCpf("529.982.247-25"), true);
  assert.equal(validCpf("11111111111"), false);
  assert.equal(validCpf("52998224726"), false);
  assert.equal(birthToSerpro("1996-11-05"), "05111996");
  assert.equal(birthToSerpro("2026-02-30"), null);
  assert.equal(birthToSerpro("1900-02-29"), null);
});

test("integração Serpro fica desativada sem contrato e chave de operador", async () => {
  const api = createSerproCpfClient({ env: {}, fetchFn: async () => { throw new Error("não consultar"); } });
  assert.equal(api.configured(), false);
  assert.equal(api.authorized("x"), false);
  await assert.rejects(api.lookup("52998224725", "1996-11-05"), /desativada/);
});

test("chave administrativa não é aceita quando incorreta", () => {
  const api = createSerproCpfClient({ env: ENV });
  assert.equal(api.configured(), true);
  assert.equal(api.authorized("outra-chave"), false);
  assert.equal(api.authorized(ENV.CPF_OPERATOR_KEY), true);
});

test("usa OAuth2 e consulta Serpro v3, filtrando retorno pessoal", async () => {
  const calls = [];
  const api = createSerproCpfClient({
    env: ENV,
    now: () => 1700000000000,
    fetchFn: async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith("/token")) {
        return { ok: true, status: 200, json: async () => ({ access_token: "token-123", expires_in: 3600 }) };
      }
      return { ok: true, status: 206, json: async () => ({
        ni: "52998224725", nome: "PESSOA DE TESTE",
        situacao: { codigo: "0", descricao: "Regular" }, nascimento: "05111996",
        nomeSocial: "", dataInscricao: "12012000", endereco: "NÃO REPASSAR",
      }) };
    },
  });
  const first = await api.lookup("529.982.247-25", "1996-11-05");
  const second = await api.lookup("52998224725", "1996-11-05");
  assert.equal(calls.length, 3); // token único para 2 consultas
  assert.equal(calls[0].opts.method, "POST");
  assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  assert.equal(calls[1].url, "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/52998224725/05111996");
  assert.equal(calls[1].opts.headers.Authorization, "Bearer token-123");
  assert.equal(first.nome, "PESSOA DE TESTE");
  assert.equal(first.situacao, "Regular");
  assert.equal(first.parcial, true);
  assert.equal(first.endereco, undefined);
  assert.equal(first.nascimento, undefined);
  assert.equal(second.nome, first.nome);
});

test("não chama a API em dados inválidos", async () => {
  let calls = 0;
  const api = createSerproCpfClient({ env: ENV, fetchFn: async () => { calls++; } });
  await assert.rejects(api.lookup("11111111111", "1996-11-05"), /inválidos/);
  await assert.rejects(api.lookup("52998224725", "2026-02-30"), /inválidos/);
  assert.equal(calls, 0);
});

test("retorno 404 não expõe dados retornados pelo fornecedor", async () => {
  const api = createSerproCpfClient({
    env: ENV,
    fetchFn: async (url) => url.endsWith("/token")
      ? { ok: true, status: 200, json: async () => ({ access_token: "test", expires_in: 3600 }) }
      : { ok: false, status: 404, json: async () => ({ erro: "DATA_NASCIMENTO_DIVERGENTE" }) },
  });
  await assert.rejects(api.lookup("52998224725", "1996-11-05"), /não correspondem/);
});
