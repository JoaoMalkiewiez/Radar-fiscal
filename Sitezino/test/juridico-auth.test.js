"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { File } = require("node:buffer");
const { webcrypto } = require("node:crypto");
const investigationSource = fs.readFileSync(path.join(__dirname, "..", "juridico-investigacao.js"), "utf8");
const source = fs.readFileSync(path.join(__dirname, "..", "juridico-portal.js"), "utf8");
const config = { url: "https://synthetic.supabase.co", publishableKey: "synthetic-public-key" };
const session = (id = "user-a", extra = {}) => ({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", expires_in: 3600, user: { id }, ...extra });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

async function portal(handler = () => json([]), { hash = "", search = "", configResponse, configPending, investigation = false, abortSignal = AbortSignal } = {}) {
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
    document: { getElementById: node, querySelectorAll(selector) { return selector === "form" ? [...nodes.values()].filter(n => n.id.endsWith("-form")) : []; }, createElement: tag => node(tag + Math.random()), createTextNode: text => ({textContent: text}) },
    location, history: { replaceState(...args) { history.push(args[2]); } },
    fetch: async (url, options) => { calls.push({ url, options }); return url === "/api/juridico/config" ? (configPending ? configPending.promise : configResponse || json(config)) : handler(url, options); },
    File, crypto: webcrypto, RuralCsv: require("../rural-csv"),
    FormData: class {
      constructor(form) { this.fields = form.elements; }
      get(key) { const field = this.fields[key]; return field?.files?.[0] || field?.value || null; }
    },
    URLSearchParams, AbortSignal: abortSignal, Option: function(text, value) { this.text = text; this.value = value; },
    Date, setTimeout, URL, console: { log() { throw Error("Unexpected log"); } },
  });
  vm.runInContext(source, context);
  if (investigation) vm.runInContext(investigationSource, context);
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

// Os dois scripts reais compartilham a mesma geração de sessão neste contexto.
const csv = 'Titular;Denominação;Código do Imóvel\nPessoa Fictícia;Imóvel sintético;123';
const investigationCases = [
  {name:'CNPJ', form:'investigation-form', status:'investigation-status', result:'investigation-result',
    fields:{cnpj:'00000000000000',purpose:'Diligência fictícia'}, payload:{brasil:{razao_social:'Empresa sintética A'}}},
  {name:'DataJud', form:'datajud-form', status:'datajud-status', result:'datajud-results',
    fields:{number:'00000000000000000000',tribunal:'tjsc'}, payload:{records:[{numeroProcesso:'00000000000000000000'}],source:'Fonte sintética',searchedAt:'2026-11-11',tribunal:'tjsc',coverage:'Teste',sourceUrl:'https://example.invalid'}},
  {name:'SNCR', form:'rural-form', status:'rural-status', result:'rural-result',
    fields:{holder:'Pessoa Fictícia',scope:'Município fictício'}},
];
function prepareInvestigation(p, item, read = async () => csv) {
  const file = new File([csv], 'synthetic.csv', {type:'text/csv'});
  file.text = read;
  p.node('rural-form').elements.file = {value:'synthetic.csv', files:[file]};
  seed(p); p.node('workspace').hidden = false;
  return () => p.submit(item.form, item.fields);
}
for (const item of investigationCases) {
  test(item.name + ': mesma sessão preserva resultado e controles', async () => {
    const p = await portal(url => url.includes('/rest/') ? json([{enabled:true}]) : json(item.payload), {investigation:true});
    await prepareInvestigation(p,item)();
    assert.ok(p.node(item.result).children.length > 0);
    assert.equal(p.node(item.form).querySelector().disabled, false);
    assert.doesNotMatch(p.node(item.status).textContent, /Falha|não foi possível/i);
  });
  for (const phase of item.name === 'SNCR' ? ['authorization','file'] : ['authorization','response','body']) {
    for (const nextUser of [null, 'user-b', 'user-a']) {
      test(`${item.name}: resposta em ${phase} é descartada após logout / ${nextUser || 'sem sessão'}`, async () => {
        const pending = deferred();
        let externalCalls = 0;
        const p = await portal(url => {
          if (url.includes('/rest/')) return phase === 'authorization' ? pending.promise : json([{enabled:true}]);
          externalCalls++;
          return phase === 'response' ? pending.promise : {ok:true,json:()=>pending.promise};
        }, {investigation:true});
        const start = prepareInvestigation(p,item, () => pending.promise);
        const attempt = start(); await tick();
        p.run('logout()');
        assert.equal(p.node(item.status).textContent,'');
        assert.equal(p.node(item.form).querySelector().disabled,false);
        if (nextUser) {
          // Simula a nova sessão autenticada; inclusive reentrada da mesma conta.
          seed(p); p.run(`currentUser=${JSON.stringify(nextUser)}`); p.node('workspace').hidden=false;
          p.node(item.status).textContent='Consulta da nova sessão em andamento';
          p.node(item.result).append('Resultado exclusivo da nova sessão');
          p.node(item.form).querySelector().disabled=true;
          p.node('rural-form').elements.file.value='new-session.csv';
        }
        pending.resolve(phase === 'authorization' ? json([{enabled:true}]) : phase === 'response' ? json(item.payload) : phase === 'file' ? csv : item.payload);
        await attempt;
        assert.equal(p.node(item.status).textContent,nextUser ? 'Consulta da nova sessão em andamento' : '');
        assert.deepEqual(p.node(item.result).children,nextUser ? ['Resultado exclusivo da nova sessão'] : []);
        assert.equal(p.node(item.form).querySelector().disabled,Boolean(nextUser));
        if (nextUser && item.name === 'SNCR') assert.equal(p.node('rural-form').elements.file.value,'new-session.csv');
        if (phase === 'authorization') assert.equal(externalCalls,0);
      });
    }
  }
  for (const nextUser of [null,'user-b']) test(`${item.name}: falha tardia não altera status/finally após logout / ${nextUser}`, async () => {
    const pending = deferred();
    const p = await portal(url => url.includes('/rest/') ? json([{enabled:true}]) : pending.promise.then(()=>{throw Error('Falha da sessão A');}), {investigation:true});
    const attempt = prepareInvestigation(p,item,()=>pending.promise.then(()=>{throw Error('Falha do CSV da sessão A');}))();
    await tick(); p.run('logout()');
    if (nextUser) {seed(p); p.run("currentUser='user-b'"); p.node('workspace').hidden=false;}
    p.node(item.status).textContent='Status atual';
    p.node(item.form).querySelector().disabled=true;
    p.node('rural-form').elements.file.value='new-session.csv';
    pending.resolve(); await attempt;
    assert.equal(p.node(item.status).textContent,'Status atual');
    assert.equal(p.node(item.form).querySelector().disabled,true);
    assert.equal(p.node('rural-form').elements.file.value,'new-session.csv');
  });
}

// Relógio determinístico: sem esperar minutos, mas com AbortSignal real e aborto observado pelo fetch.
function timeoutClock() {
  let now = 0;
  const deadlines = [];
  return {
    signal: { timeout(ms) { const controller = new AbortController(); deadlines.push({at:now+ms,controller}); return controller.signal; } },
    advance(ms) { now+=ms; for (const {at,controller} of deadlines) if(at<=now) controller.abort(new DOMException('Timed out','TimeoutError')); },
  };
}
function abortable(signal, pending) {
  return new Promise((resolve,reject)=>{
    if(signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort',()=>reject(signal.reason),{once:true});
    pending.promise.then(resolve,reject);
  });
}
test('timeout normal: leitura é abortada aos 30 s, sem repetir requisição', async () => {
  const clock=timeoutClock(), pending=deferred();
  const p=await portal((url,opts)=>abortable(opts.signal,pending),{abortSignal:clock.signal}); seed(p);
  const read=p.run('api("/legal_clients")'); const rejected=assert.rejects(read,/temporariamente indisponível/);
  clock.advance(29000); assert.equal(p.calls.at(-1).options.signal.aborted,false);
  clock.advance(1000); await rejected;
  assert.equal(p.calls.length,2);
});
for(const method of ['POST','PUT','GET']) test(`transferência ${method}: 10 MB completam após 20 s, antes do limite de 5 min`,async()=>{
  const clock=timeoutClock(),pending=deferred();
  const p=await portal((url,opts)=>abortable(opts.signal,pending),{abortSignal:clock.signal}); seed(p);
  p.context.transferFile=new File([new Uint8Array(10485760)],'synthetic.pdf',{type:'application/pdf'});
  const transfer=p.run(`api('/object/legal-private/user-a/synthetic.pdf',{method:'${method}',storage:true${method==='GET'?'':',body:transferFile'}})`);
  clock.advance(120000); assert.equal(p.calls.at(-1).options.signal.aborted,false);
  if(method!=='GET') assert.equal(p.calls.at(-1).options.body.size,10485760);
  pending.resolve(method==='GET' ? new Response(new Uint8Array(10485760),{headers:{'content-type':'application/pdf'}}) : json({}));
  const result=await transfer;
  if(method==='GET') assert.equal(result.size,10485760);
  assert.equal(p.calls.length,2);
});
test('upload: timeout de 5 min informa gravação incerta sem repetição',async()=>{
  const clock=timeoutClock(),pending=deferred();
  const p=await portal((url,opts)=>abortable(opts.signal,pending),{abortSignal:clock.signal}); seed(p);
  const upload=p.run("api('/object/legal-private/user-a/file.pdf',{method:'POST',storage:true,body:'synthetic'})");
  const rejected=assert.rejects(upload,e=>e.uncertainWrite && /resultado da gravação é incerto/.test(e.message));
  clock.advance(299999);assert.equal(p.calls.at(-1).options.signal.aborted,false);
  clock.advance(1);await rejected;assert.equal(p.calls.length,2);
});
for(const operation of [()=>{throw Error('network');},()=>json({},503),()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>{throw Error('truncated');}})]) test('gravação sem confirmação sinaliza resultado incerto: '+operation.toString(),async()=>{
  const p=await portal(operation);seed(p);
  await assert.rejects(p.run("api('/legal_clients',{method:'POST',body:{name:'Synthetic'}})"),e=>e.uncertainWrite && /antes de repetir/.test(e.message));
  assert.equal(p.calls.length,2);
});
async function uploadForm(p, file = new File(['synthetic'],'synthetic.pdf',{type:'application/pdf'})) {
  p.node('document-form').elements.file={files:[file],value:'synthetic.pdf'};
  p.node('document-form').elements.case_id={value:''};
  await p.node('document-form').listeners.submit({preventDefault(){},currentTarget:p.node('document-form')});
}
test('metadados com resposta incerta não apagam objeto enviado',async()=>{
  const p=await portal(url=>url.includes('/storage/')?json({}):Promise.reject(Error('lost response')));seed(p);
  await uploadForm(p);
  assert.match(p.node('feedback').textContent,/resultado da gravação é incerto/);
  assert.equal(p.calls.filter(c=>c.options.method==='DELETE').length,0);
  assert.equal(p.calls.filter(c=>c.options.method==='POST').length,2);
});
test('metadados rejeitados definitivamente mantêm limpeza do objeto',async()=>{
  const p=await portal(url=>url.includes('/rest/')?json({},400):json({}));seed(p);
  await uploadForm(p);
  assert.equal(p.calls.filter(c=>c.options.method==='DELETE').length,1);
});
test('falha de listagem após upload/metadados confirmados não apaga arquivo',async()=>{
  const p=await portal((url,opts)=>opts.method==='POST'?json({}):json({},503));seed(p);
  await uploadForm(p);
  assert.match(p.node('feedback').textContent,/Documento salvo/);
  assert.equal(p.calls.filter(c=>c.options.method==='DELETE').length,0);
});

for (const item of investigationCases) test(`${item.name}: login B e consulta B continuam intactos quando A termina`, async () => {
  const oldPending=deferred(),newPending=deferred(); let externalCalls=0;
  const p=await portal(url=>{
    if(url.includes('grant_type=password')) return json(session('user-b'));
    if(url.includes('legal_access')) return json([{enabled:true,role:'administrador'}]);
    if(url.includes('/rest/')) return json([]);
    return ++externalCalls===1 ? oldPending.promise : newPending.promise;
  },{investigation:true});
  const oldAttempt=prepareInvestigation(p,item,()=>oldPending.promise)();
  await tick(); p.run('logout()'); await login(p);
  assert.equal(p.run('currentUser'),'user-b'); assert.equal(p.node('workspace').hidden,false);
  const fileB=new File([csv],'new-session.csv',{type:'text/csv'}); fileB.text=()=>newPending.promise;
  p.node('rural-form').elements.file={files:[fileB],value:'new-session.csv'};
  const newAttempt=p.submit(item.form,item.fields); await tick();
  const statusB=p.node(item.status).textContent;
  oldPending.resolve(item.name==='SNCR'?csv:json(item.payload));await oldAttempt;
  assert.equal(p.node(item.status).textContent,statusB);
  assert.equal(p.node(item.form).querySelector().disabled,true);
  assert.equal(p.node(item.result).children.length,0);
  if(item.name==='SNCR')assert.equal(p.node('rural-form').elements.file.value,'new-session.csv');
  newPending.resolve(item.name==='SNCR'?csv:json(item.payload));await newAttempt;
  assert.ok(p.node(item.result).children.length>0);
  assert.equal(p.node(item.form).querySelector().disabled,false);
});
test('formulário aceita PDF de 10 MB e upload lento sem usar timeout normal',async()=>{
  const clock=timeoutClock(),pending=deferred();
  const p=await portal((url,opts)=>url.includes('/storage/')?abortable(opts.signal,pending):json(opts.method==='POST'?{}:[]),{abortSignal:clock.signal});seed(p);
  const flow=uploadForm(p,new File([new Uint8Array(10485760)],'synthetic.pdf',{type:'application/pdf'}));
  clock.advance(120000);assert.equal(p.node('document-form').querySelector().disabled,true);
  pending.resolve(json({}));await flow;
  assert.match(p.node('feedback').textContent,/Registro salvo com sucesso/);
  const metadata=p.calls.find(c=>c.url.endsWith('/legal_documents'));
  assert.equal(JSON.parse(metadata.options.body).size_bytes,10485760);
  assert.equal(p.calls.filter(c=>c.options.method==='POST').length,2);
});
test('upload perdido antes da confirmação não cria metadados e avisa resultado incerto',async()=>{
  const clock=timeoutClock(),pending=deferred();
  const p=await portal((url,opts)=>abortable(opts.signal,pending),{abortSignal:clock.signal});seed(p);
  const flow=uploadForm(p);clock.advance(300000);await flow;
  assert.match(p.node('feedback').textContent,/resultado da gravação é incerto/);
  assert.equal(p.node('document-form').querySelector().disabled,false);
  assert.equal(p.calls.length,2);
});
test('upload tardio após logout não cria metadados na sessão B nem altera controles',async()=>{
  const pending=deferred();const p=await portal(()=>pending.promise);seed(p);
  const flow=uploadForm(p);p.run('logout()');
  seed(p);p.run("currentUser='user-b'");
  p.node('feedback').textContent='Sessão B';p.node('document-form').querySelector().disabled=true;
  pending.resolve(json({}));await flow;
  assert.equal(p.calls.length,2);
  assert.equal(p.node('feedback').textContent,'Sessão B');
  assert.equal(p.node('document-form').querySelector().disabled,true);
});
for(const [method,storage] of [['POST',false],['DELETE',true]])test(`${method}, storage=${storage}: escrita normal aborta em 30 s sem repetir`,async()=>{
  const clock=timeoutClock(),pending=deferred();
  const p=await portal((url,opts)=>abortable(opts.signal,pending),{abortSignal:clock.signal});seed(p);
  const action=p.run(`api('/synthetic',{method:'${method}',storage:${storage},body:{name:'Synthetic'}})`);
  const rejected=assert.rejects(action,e=>e.uncertainWrite && /resultado da gravação é incerto/.test(e.message));
  clock.advance(30000);await rejected;assert.equal(p.calls.length,2);
});

function inlineClientEditor(p, suffix) {
  const row=p.node('edit-row-'+suffix); row.querySelector=()=>null;
  p.context.editRow=row;
  p.run("showRecordEditor('clients',{id:'synthetic-client',kind:'pf',name:'Synthetic'},editRow)");
  const form=row.children.at(-1), button=form.children.at(-1).children[0];
  form.elements={kind:{value:'pf'},name:{value:'Synthetic '+suffix}};
  return {form,button};
}
const crudCases=[
  {name:'cadastro', phases:['write','reload'], begin(p){
    const flow=p.submit('client-form',{kind:'pf',name:'Synthetic A'});
    return {flow,form:p.node('client-form'),button:p.node('client-form').querySelector()};
  }},
  {name:'edição', phases:['write','reload'], begin(p){
    const {form,button}=inlineClientEditor(p,'A');
    return {flow:form.listeners.submit({preventDefault(){},currentTarget:form}),form,button};
  }},
  {name:'exclusão de registro', phases:['write','reload'], begin(p){
    const button=p.run("createButton('Excluir',()=>removeRecord('clients',{id:'synthetic-client'}))");
    return {flow:button.listeners.click(),button};
  }},
  {name:'exclusão de documento', phases:['storage','write','reload'], begin(p){
    const button=p.run("createButton('Excluir',()=>removeRecord('documents',{id:'synthetic-document',storage_path:'user-a/synthetic.pdf'}))");
    return {flow:button.listeners.click(),button};
  }},
];
for(const item of crudCases) for(const phase of item.phases) {
  for(const outcome of ['success','server-error','network-error']) for(const userB of [false,true]) {
    test(`CRUD ${item.name}: ${phase}/${outcome}, logout${userB?' e login B':''} preservam UI atual`,async()=>{
      const pending=deferred();let holdA=true,held=0;
      const p=await portal((url,opts)=>{
        if(url.includes('grant_type=password'))return json(session('user-b'));
        if(url.includes('legal_access'))return json([{enabled:true}]);
        const storage=url.includes('/storage/');
        const shouldHold=holdA && (phase==='reload'?opts.method==='GET':phase==='storage'?storage:opts.method!=='GET'&&!storage);
        if(shouldHold){held++;return pending.promise.then(()=>{
          if(outcome==='network-error')throw Error('Network failure from A');
          return json(phase==='reload'?[]:{},outcome==='server-error'?503:200);
        });}
        return json(opts.method==='GET'?[]:{});
      });
      seed(p);p.node('workspace').hidden=false;
      const old=item.begin(p);await tick();assert.ok(held>0,'A alcançou a etapa pendente');
      p.run('logout()');holdA=false;
      assert.equal(p.node('client-form').querySelector().disabled,false);
      if(userB){await login(p);assert.equal(p.run('currentUser'),'user-b');}
      p.node('feedback').textContent='Mensagem da interface atual';
      const formB=p.node('client-form');formB.elements.name={value:'Rascunho exclusivo de B'};
      formB.querySelector().disabled=true;
      const editorB=inlineClientEditor(p,'B');editorB.button.disabled=true;
      editorB.form.elements.name.value='Edição exclusiva de B';
      const callsBefore=p.calls.length;
      pending.resolve();await old.flow;
      assert.equal(p.node('feedback').textContent,'Mensagem da interface atual');
      assert.equal(formB.elements.name.value,'Rascunho exclusivo de B');
      assert.equal(formB.querySelector().disabled,true);
      assert.equal(editorB.form.elements.name.value,'Edição exclusiva de B');
      assert.equal(editorB.button.disabled,true);
      assert.equal(old.button.disabled,true,'finally antigo não modifica nem controle destacado');
      assert.equal(p.calls.length,callsBefore,'nenhuma continuação envia nova requisição pela sessão B');
    });
  }
}
for(const item of crudCases) for(const outcome of ['success','failure']) {
  test(`CRUD ${item.name}: ${outcome} na mesma sessão mantém feedback/controles`,async()=>{
    const p=await portal((url,opts)=>json(opts.method==='GET'?[]:{},opts.method!=='GET'&&outcome==='failure'?400:200));seed(p);
    const action=item.begin(p);await action.flow;
    assert.equal(action.button.disabled,false);
    assert.match(p.node('feedback').textContent,outcome==='failure'?/Operação não concluída/:/Registro (salvo|atualizado|excluído)/);
    if(item.name==='cadastro')assert.equal(action.form.elements.name.value,outcome==='success'?'':'Synthetic A');
  });
}
for(const [id,fields] of [
  ['case-form',{title:'Synthetic case',status:'ativo'}],
  ['event-form',{title:'Synthetic event',kind:'tarefa',starts_at:'2026-11-11T12:00'}],
  ['movement-form',{title:'Synthetic movement',case_id:'synthetic-case',happened_at:'2026-11-11T12:00'}],
])test(`${id}: cadastro tardio não limpa formulário nem habilita botão de B`,async()=>{
  const pending=deferred();
  const p=await portal((url,opts)=>url.includes('grant_type=password')?json(session('user-b')):url.includes('legal_access')?json([{enabled:true}]):opts.method==='POST'?pending.promise:json([]));seed(p);
  const flow=p.submit(id,fields);p.run('logout()');
  assert.equal(p.node(id).querySelector().disabled,false);
  await login(p);p.node(id).elements.title.value='Rascunho B';p.node(id).querySelector().disabled=true;
  p.node('feedback').textContent='Mensagem B';pending.resolve(json({}));await flow;
  assert.equal(p.node(id).elements.title.value,'Rascunho B');
  assert.equal(p.node(id).querySelector().disabled,true);
  assert.equal(p.node('feedback').textContent,'Mensagem B');
});

// Exercita também a fronteira entre a Promise resolvida e a continuação do helper.
// A troca pode ocorrer nessa microtask, depois da última guarda interna de api/reloadData.
for(const operation of [
  "insert('legal_clients',{name:'Synthetic A'})",
  "updateRecord('legal_clients','synthetic-a',{name:'Synthetic A'})",
  "removeRecord('clients',{id:'synthetic-a'})",
])for(const boundary of ['api','reloadData'])test(`${operation}: guarda após ${boundary} impede continuação na geração B`,async()=>{
  const p=await portal();seed(p);
  p.context.transitionToB=()=>{
    p.run('logout()');seed(p);p.run("currentUser='user-b'");
    p.node('feedback').textContent='Mensagem B';
  };
  p.run(`
    let helperRequests=0;
    api=async()=>{helperRequests++;${boundary==='api'?'transitionToB();':''}};
    reloadData=async()=>{${boundary==='reloadData'?'transitionToB();':''}};
  `);
  await assert.rejects(p.run(operation),/Sessão expirada/);
  assert.equal(p.node('feedback').textContent,'Mensagem B');
  assert.equal(p.run('helperRequests'),1);
});
test('exclusão de documento: mudança de geração após objeto impede DELETE dos metadados',async()=>{
  const p=await portal();seed(p);
  p.context.transitionToB=()=>{p.run('logout()');seed(p);p.run("currentUser='user-b'");};
  p.run('let deleteRequests=0; api=async()=>{deleteRequests++;transitionToB();};');
  await assert.rejects(p.run("removeRecord('documents',{id:'synthetic-doc',storage_path:'user-a/synthetic.pdf'})"),/Sessão expirada/);
  assert.equal(p.run('deleteRequests'),1);
});
