"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "..", "juridico-portal.js"), "utf8");
const config = { url: "https://synthetic.supabase.co", publishableKey: "synthetic-public-key" };
const session = (id = "user-a", extra = {}) => ({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, user: { id }, ...extra });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function portal(handler = () => json([]), { hash = "", search = "", configResponse, configPending } = {}) {
  const nodes = new Map();
  function node(id = "") {
    if (nodes.has(id)) return nodes.get(id);
    const n = { id, hidden: true, value: "", textContent: "", children: [], listeners: {}, disabled: false,
      classList: { toggle() {}, add() {} }, dataset: {}, elements: {},
      addEventListener(type, callback) { this.listeners[type] = callback; },
      querySelector() { return this.button ||= node(id + "-button"); },
      replaceChildren(...children) { this.children = children; this.textContent = ""; },
      append(...children) { this.children.push(...children); }, add(option) { this.children.push(option); },
      reset() { for (const field of Object.values(this.elements)) field.value = ""; }, setAttribute() {},
    };
    nodes.set(id, n); return n;
  }
  const calls = [], history = [];
  const location = { hash, search, pathname: "/juridico/portal", origin: "https://radar.example" };
  const context = vm.createContext({
    document: { getElementById: node, querySelectorAll(selector) { return selector === "form" ? [...nodes.values()].filter(n => n.id.endsWith("-form")) : []; }, createElement: tag => node(tag + Math.random()) },
    location, history: { replaceState(...args) { history.push(args[2]); } },
    fetch: async (url, options) => { calls.push({ url, options }); return url === "/api/juridico/config" ? (configPending ? configPending.promise : configResponse || json(config)) : handler(url, options); },
    URLSearchParams, AbortSignal, Option: function(text, value) { this.text = text; this.value = value; },
    Date, setTimeout, URL, console: { log() { throw Error("Unexpected log"); } },
  });
  vm.runInContext(source, context);
  if (!configPending) await tick();
  const run = code => vm.runInContext(code, context);
  async function submit(id, fields) {
    const form = node(id);
    for (const [key, value] of Object.entries(fields)) form.elements[key] = { value };
    await form.listeners.submit({ preventDefault() {}, currentTarget: form });
  }
  return { node, run, submit, calls, history, context };
}
const login = p => p.submit("login-form", { email: "person@example.invalid", password: "synthetic-password" });
const seed = p => p.run(`accessToken='old'; refreshToken='renew'; currentUser='user-a'; tokenExpiresAt=Date.now()+3600000;`);

test("login autorizado administrador carrega dados privados e abre painel", async () => {
  const p = await portal(url => url.includes("grant_type=password") ? json(session()) : url.includes("legal_access") ? json([{ enabled: true, role: "administrador" }]) : json([]));
  await login(p);
  assert.equal(p.node("workspace").hidden, false);
  assert.equal(p.node("login-form").elements.password.value, "");
  assert.equal(p.calls.filter(c => c.url.includes("/rest/v1/legal_")).length, 7);
});
for (const membership of [[], [{ enabled: false }], [{ enabled: "true" }]]) test("sem autorização ativa não consulta registros: " + JSON.stringify(membership), async () => {
  const p = await portal(url => url.includes("grant_type=password") ? json(session()) : json(membership));
  await login(p);
  assert.match(p.node("feedback").textContent, /não foi autorizada/);
  assert.equal(p.run("accessToken"), null);
  assert.equal(p.calls.filter(c => c.url.includes("/rest/v1/legal_")).length, 1);
});
for (const status of [400, 401]) test("credenciais inválidas têm mensagem genérica: " + status, async () => {
  const p = await portal(() => json({ msg: "Account person@example.invalid does not exist" }, status));
  await login(p);
  assert.match(p.node("feedback").textContent, /Verifique as credenciais/);
  assert.doesNotMatch(p.node("feedback").textContent, /person@|does not exist/);
  assert.equal(p.run("accessToken"), null);
});
for (const response of [() => json({}, 503), () => { throw new TypeError("secret upstream URL"); }, () => new Response(""), () => json(null)]) test("login trata indisponibilidade, rede ou resposta vazia: " + response.toString(), async () => {
  const p = await portal(response); await login(p);
  assert.match(p.node("feedback").textContent, /temporariamente indisponível/);
  assert.equal(p.node("login-form").querySelector().disabled, false);
});
test("recuperação usa somente origem e rota fixa, ignorando return URL arbitrária", async () => {
  const p = await portal(() => json({}), { search: "?next=https://evil.invalid" });
  await p.submit("recover-form", { email: "person@example.invalid" });
  const call = p.calls[1];
  assert.equal(new URL(call.url).searchParams.get("redirect_to"), "https://radar.example/juridico/portal");
  assert.match(p.node("feedback").textContent, /Se o e-mail estiver cadastrado/);
});
test("HTTP 429 não confirma envio e bloqueia repetição antes de Retry-After", async () => {
  const p = await portal(() => json({}, 429, { "retry-after": "120" }));
  await p.submit("recover-form", { email: "person@example.invalid" });
  assert.match(p.node("feedback").textContent, /limite temporário de envios/);
  assert.ok(p.run("recoveryRetryAt-Date.now()") > 110000);
  await p.submit("recover-form", { email: "person@example.invalid" });
  assert.equal(p.calls.length, 2);
  assert.match(p.node("feedback").textContent, /Aguarde/);
});
for (const type of ["invite", "recovery"]) test(type + ": limpa URL antes da configuração e permite definir senha", async () => {
  const pending = deferred();
  const p = await portal(() => json({}), { configPending: pending, hash: `#type=${type}&access_token=fake&refresh_token=fake-renew&expires_in=3600` });
  assert.deepEqual(p.history, ["/juridico/portal"]);
  pending.resolve(json(config)); await tick();
  assert.equal(p.node("password-panel").hidden, false);
  await p.submit("password-form", { password: "new-synthetic-password", confirm: "new-synthetic-password" });
  assert.equal(p.calls[1].options.method, "PUT");
  assert.equal(p.run("accessToken"), null);
  assert.match(p.node("feedback").textContent, /Senha definida/);
});
for (const hash of ["#error=access_denied&error_description=secret", "#type=other&access_token=fake&refresh_token=r", "#type=invite&access_token=fake", "#type=invite&access_token=fake&refresh_token=r&expires_in=-1"]) test("rejeita link inválido sem expor detalhes: " + hash, async () => {
  const p = await portal(undefined, { hash });
  assert.equal(p.history[0], "/juridico/portal");
  assert.equal(p.run("accessToken"), null);
  assert.equal(p.node("password-panel").hidden, true);
});
test("remove credenciais query e fragmento mesmo com configuração indisponível", async () => {
  const p = await portal(undefined, { search: "?access_token=secret&next=safe", configResponse: json({}, 503) });
  assert.equal(p.history[0], "/juridico/portal?next=safe");
  assert.equal(p.run("accessToken"), null);
  assert.equal(p.node("setup").hidden, false);
});
test("senha inválida não faz requisição", async () => {
  const p = await portal();
  await p.submit("password-form", { password: "short", confirm: "short" });
  assert.equal(p.calls.length, 1);
});
test("token expirado renova uma única vez para requisições simultâneas", async () => {
  const pending = deferred();
  let refreshes = 0;
  const p = await portal(url => url.includes("grant_type=refresh_token") ? (refreshes++, pending.promise) : json([]));
  seed(p); p.run("tokenExpiresAt=0");
  const a = p.run('api("/legal_clients")'), b = p.run('api("/legal_cases")');
  pending.resolve(json(session())); await Promise.all([a,b]);
  assert.equal(refreshes, 1);
  assert.equal(p.calls.at(-1).options.headers.Authorization, "Bearer synthetic-access");
});
test("refresh inválido encerra sessão e bloqueia registros", async () => {
  const p = await portal(() => json({}, 400)); seed(p); p.run("tokenExpiresAt=0");
  await assert.rejects(p.run('api("/legal_clients")'), /Sessão expirada/);
  assert.equal(p.run("accessToken"), null);
  assert.equal(p.calls.length, 2);
});
test("refresh de outra identidade é rejeitado", async () => {
  const p = await portal(() => json(session("user-b"))); seed(p);
  await assert.rejects(p.run("refreshAccessToken()"), /Sessão expirada/);
  assert.equal(p.run("currentUser"), null);
});
test("401 renova e tenta novamente somente uma vez", async () => {
  let attempts = 0;
  const p = await portal(url => url.includes("refresh_token") ? json(session()) : (attempts++, json({}, 401))); seed(p);
  await assert.rejects(p.run('api("/legal_clients")'), /Sessão expirada/);
  assert.equal(attempts, 2);
  assert.equal(p.run("accessToken"), null);
});
test("logout durante refresh impede restauração e limpa DOM e formulários", async () => {
  const pending = deferred(); const p = await portal(() => pending.promise); seed(p);
  p.node("client-list").append("synthetic confidential row");
  const refresh = p.run("refreshAccessToken()");
  p.run("logout()"); pending.resolve(json(session()));
  await assert.rejects(refresh, /Sessão expirada/);
  assert.equal(p.run("accessToken"), null);
  assert.equal(p.node("client-list").children.length, 0);
});
test("resposta privada após logout não repopula estado", async () => {
  const pending = deferred(); const p = await portal(() => pending.promise); seed(p);
  const reload = p.run("reloadData()"); p.run("logout()"); pending.resolve(json([{ name: "Synthetic A" }]));
  await assert.rejects(reload, /Sessão expirada/);
  assert.equal(p.run("state.clients.length"), 0);
});
test("403 privado encerra sessão e não deixa dados visíveis", async () => {
  const p = await portal(() => json({}, 403)); seed(p);
  await assert.rejects(p.run('api("/legal_clients")'), /não possui autorização/);
  assert.equal(p.node("workspace").hidden, true);
  assert.equal(p.run("accessToken"), null);
});
test("sem sessão nenhuma rota de registros ou Storage é consultada", async () => {
  const p = await portal();
  await assert.rejects(p.run('api("/legal_clients")'), /Faça login/);
  await assert.rejects(p.run('api("/object/authenticated/legal-private/user-b/file.pdf", {storage:true})'), /Faça login/);
  assert.equal(p.calls.length, 1);
});
test("logout local ocorre mesmo se revogação remota falhar", async () => {
  const p = await portal(() => { throw Error("offline"); }); seed(p);
  await p.node("logout").listeners.click();
  assert.equal(p.run("accessToken"), null);
  assert.match(p.node("feedback").textContent, /não foi possível confirmar/);
});

test("login HTTP 429 não revela conta e libera botão", async () => {
  const p = await portal(() => json({}, 429)); await login(p);
  assert.match(p.node("feedback").textContent, /Muitas tentativas/);
  assert.equal(p.node("login-form").querySelector().disabled, false);
});
for (const reply of [() => json({}, 503), () => { throw Error("offline"); }]) test("recuperação indisponível não confirma envio: " + reply.toString(), async () => {
  const p = await portal(reply);
  await p.submit("recover-form", { email: "person@example.invalid" });
  assert.match(p.node("feedback").textContent, /temporariamente indisponível/);
  assert.doesNotMatch(p.node("feedback").textContent, /Solicitação aceita/);
});
test("redefinição com token expirado informa convite inválido sem abrir painel", async () => {
  const p = await portal(() => json({}, 401), {hash:'#type=recovery&access_token=fake&refresh_token=renew&expires_in=3600'});
  await p.submit("password-form", { password: "new-synthetic-password", confirm: "new-synthetic-password" });
  assert.match(p.node("feedback").textContent, /convite pode ter expirado/);
  assert.equal(p.node("workspace").hidden, true);
});
test("carregamento do login é explícito e resposta tardia após logout não abre painel", async () => {
  const pending = deferred(); const p = await portal(() => pending.promise);
  const attempt = login(p);
  assert.equal(p.node("login-form").querySelector().textContent, "Entrando…");
  assert.equal(p.node("login-form").querySelector().disabled, true);
  p.run("logout()"); pending.resolve(json(session())); await attempt;
  assert.equal(p.node("workspace").hidden, true);
  assert.equal(p.run("accessToken"), null);
});
test("expiração inválida na resposta de login não cria sessão", async () => {
  const p = await portal(() => json(session("user-a", {expires_in:0}))); await login(p);
  assert.equal(p.run("accessToken"), null);
});
test("falha parcial ao carregar tabelas não publica registros parciais", async () => {
  const p = await portal(url => url.includes("legal_cases") ? json({}, 503) : json([{name:'Synthetic A'}])); seed(p);
  await assert.rejects(p.run("reloadData()"), /temporariamente indisponível/);
  assert.equal(p.run("state.clients.length"), 0);
});
test("Storage negado limpa sessão e preserva isolamento no cliente", async () => {
  const p = await portal(() => json({}, 403)); seed(p);
  await assert.rejects(p.run('api("/object/authenticated/legal-private/user-b/file.pdf", {storage:true})'), /não possui autorização/);
  assert.equal(p.run("accessToken"), null);
});
