"use strict";

// Sem dados pessoais em localStorage, sessionStorage ou logs.
// Toda autorização de registros e arquivos é aplicada pelas políticas RLS do banco.
let settings = null;
let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;
let currentUser = null;
let refreshInFlight = null;
let sessionVersion = 0;
let recoveryRetryAt = 0;
const SESSION_ENDED = "Sessão expirada. Entre novamente.";
const UNAVAILABLE = "Serviço temporariamente indisponível. Verifique sua conexão e tente novamente.";

// Requisições comuns: 30 s. Upload/download privado de até 10 MB: até 5 min.
const REQUEST_TIMEOUTS = { normal: 30000, transfer: 300000 };
function operationFailure(writing = false) {
  const error = new Error(writing
    ? UNAVAILABLE + " O resultado da gravação é incerto. Confira os registros e arquivos antes de repetir."
    : UNAVAILABLE);
  error.uncertainWrite = writing;
  return error;
}

async function request(url, options, { transfer = false, writing = false } = {}) {
  try {
    return await fetch(url, {
      ...options, signal: AbortSignal.timeout(transfer ? REQUEST_TIMEOUTS.transfer : REQUEST_TIMEOUTS.normal),
    });
  } catch { throw operationFailure(writing); }
}

function authBusy(button, label) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  button.setAttribute("aria-busy", "true");
  return () => {
    button.disabled = false;
    button.textContent = original;
    button.setAttribute("aria-busy", "false");
  };
}

async function authData(response) {
  if (response.status === 429) throw new Error("Muitas tentativas. Aguarde antes de tentar novamente.");
  if (response.status >= 500) throw new Error(UNAVAILABLE);
  if (!response.ok) return {};
  try {
    const data = await response.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(UNAVAILABLE);
    return data;
  } catch { throw new Error(UNAVAILABLE); }
}

function expiresAt(seconds) {
  const lifetime = Number(seconds);
  if (!Number.isFinite(lifetime) || lifetime <= 0) throw new Error(SESSION_ENDED);
  return Date.now() + lifetime * 1000;
}
const state = { clients: [], cases: [], events: [], documents: [], movements: [], audits: [] };
const $ = (id) => document.getElementById(id);

function feedback(message) {
  const node = $("feedback");
  node.textContent = message;
  node.hidden = !message;
}

async function refreshAccessToken() {
  if (!settings || !refreshToken) throw new Error("Sessão expirada. Entre novamente.");
  if (refreshInFlight) return refreshInFlight;
  const version = sessionVersion;
  const pending = (async () => {
    const response = await request(settings.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: settings.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }), cache: "no-store",
    });
    const data = await authData(response);
    if (!response.ok || !data.access_token || !data.refresh_token || data.user?.id !== currentUser)
      throw new Error("Sessão expirada. Entre novamente.");
    if (version !== sessionVersion) throw new Error(SESSION_ENDED);
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiresAt = expiresAt(data.expires_in);
  })();
  refreshInFlight = pending;
  try { await pending; }
  catch (error) { if (version === sessionVersion) logout(); throw error; }
  finally { if (refreshInFlight === pending) refreshInFlight = null; }
}

async function api(path, { method = "GET", body, storage = false, retry = true } = {}) {
  if (!settings || !accessToken) throw new Error("Faça login para continuar.");
  const version = sessionVersion;
  if (Date.now() + 30000 >= tokenExpiresAt) await refreshAccessToken();
  if (version !== sessionVersion) throw new Error(SESSION_ENDED);
  const headers = { apikey: settings.publishableKey, Authorization: `Bearer ${accessToken}` };
  if (!storage && body !== undefined) headers["Content-Type"] = "application/json";
  const writing = !["GET", "HEAD"].includes(method);
  const transfer = storage && ["GET", "POST", "PUT"].includes(method);
  const response = await request(settings.url + (storage ? "/storage/v1" : "/rest/v1") + path, {
    method, headers, body: storage ? body : body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
  }, { transfer, writing });
  if (version !== sessionVersion) throw new Error(SESSION_ENDED);
  if (response.status === 401 && retry) {
    await refreshAccessToken();
    return api(path, { method, body, storage, retry: false });
  }
  if (response.status === 401) {
    logout();
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (response.status === 403) {
    logout();
    throw new Error("Esta conta não possui autorização para esta operação. Entre novamente ou contate o administrador.");
  }
  if (response.status >= 500) throw operationFailure(writing);
  if (!response.ok) throw new Error(`Operação não concluída (${response.status}). Verifique suas permissões.`);
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  let result;
  try { result = await (type.includes("json") ? response.json() : response.blob()); }
  catch { throw operationFailure(writing); }
  if (version !== sessionVersion) throw new Error(SESSION_ENDED);
  return result;
}

function logout() {
  sessionVersion += 1;
  refreshInFlight = null;
  accessToken = null;
  refreshToken = null;
  tokenExpiresAt = 0;
  currentUser = null;
  for (const key of Object.keys(state)) state[key] = [];
  for (const id of ["client-list", "case-list", "event-list", "document-list", "movement-list", "audit-list", "upcoming-list", "investigation-result", "rural-result", "datajud-results"])
    $(id).replaceChildren();
  for (const form of document.querySelectorAll("form")) form.reset();
  for (const id of ["investigation-status", "datajud-status", "rural-status"]) $(id).textContent = "";
  // Os finally antigos não podem reativar controles de outra sessão.
  for (const id of ["investigation-form", "datajud-form", "rural-form", "document-form"]) $(id).querySelector("button").disabled = false;
  for (const id of ["client-search", "case-search", "document-search", "event-search", "movement-search"]) $(id).value = "";
  for (const id of ["case-client", "document-case", "event-case", "movement-case"])
    $(id).replaceChildren(new Option("Sem vínculo", ""));
  for (const id of ["count-clients", "count-cases", "count-events", "count-documents"]) $(id).textContent = "0";
  $("password-panel").hidden = true;
  $("recover-panel").hidden = true;
  $("workspace").hidden = true;
  $("login-panel").hidden = !settings;
  $("logout").hidden = true;
  $("page-title").textContent = "Acesso ao escritório";
}

function show(view) {
  for (const node of document.querySelectorAll(".view")) node.hidden = node.id !== view;
  for (const link of document.querySelectorAll("[data-view]")) link.classList.toggle("active", link.dataset.view === view);
  const names = { dashboard: "Visão geral", investigation: "Investigação patrimonial", clients: "Clientes", cases: "Processos", documents: "Documentos", events: "Agenda e prazos" };
  $("page-title").textContent = names[view] || names.dashboard;
}

const RECORD_FIELDS = {
  clients: [
    ["kind", "Tipo", "select", ["pf", "pj"]], ["name", "Nome", "text"],
    ["document", "CPF/CNPJ", "text"], ["email", "E-mail", "email"],
    ["phone", "Telefone", "text"], ["notes", "Observações", "textarea"],
  ],
  cases: [
    ["title", "Título", "text"], ["cnj", "Número CNJ", "text"],
    ["court", "Tribunal", "text"], ["client_id", "Cliente", "clients"],
    ["status", "Situação", "select", ["ativo", "suspenso", "encerrado"]],
    ["notes", "Observações", "textarea"],
  ],
  movements: [
    ["case_id","Processo","cases"], ["title","Movimentação","text"],
    ["happened_at","Data","datetime-local"], ["details","Detalhes","textarea"],
  ],
  events: [
    ["title", "Título", "text"], ["kind", "Tipo", "select", ["compromisso", "audiencia", "prazo", "tarefa"]],
    ["starts_at", "Data e horário", "datetime-local"], ["case_id", "Processo", "cases"],
    ["completed", "Situação", "select", ["false", "true"]], ["notes", "Observações", "textarea"],
  ],
};
const TABLES = { clients: "legal_clients", cases: "legal_cases", events: "legal_events", documents: "legal_documents", movements: "legal_movements", audits: "legal_audit_logs" };
let agendaPendingOnly = true;

function searchable(rows, inputId, keys) {
  const query = ($(inputId)?.value || "").trim().toLocaleLowerCase("pt-BR");
  if (!query) return rows;
  return rows.filter((row) => keys.some((key) => String(row[key] ?? "").toLocaleLowerCase("pt-BR").includes(query)));
}

function createButton(text, action, variant = "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant;
  button.textContent = text;
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await action(button); }
    catch (error) { feedback(error.message); }
    finally { button.disabled = false; }
  });
  return button;
}

function itemList(target, values, makeLabel, options = {}) {
  const box = $(target);
  box.replaceChildren();
  if (!values.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum registro encontrado.";
    box.append(empty);
    return;
  }
  for (const item of values) {
    const row = document.createElement("div");
    row.className = "module";
    if (options.overdue?.(item)) row.classList.add("overdue");
    const title = document.createElement("span");
    title.textContent = makeLabel(item);
    row.append(title);
    if (options.open) row.append(createButton("Baixar", () => options.open(item)));
    if (options.complete && !item.completed) row.append(createButton("Concluir", async () => {
      await updateRecord(TABLES.events, item.id, { completed: true });
    }));
    if (options.edit) row.append(createButton("Editar", () => showRecordEditor(options.edit, item, row)));
    if (options.remove) {
      row.append(createButton("Excluir", async (button) => {
        if (button.dataset.confirm !== "yes") {
          button.dataset.confirm = "yes";
          button.textContent = "Confirmar exclusão";
          button.classList.add("danger");
          return;
        }
        await removeRecord(options.remove, item);
      }, "danger"));
    }
    box.append(row);
  }
}

function localDateTime(iso) {
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function showRecordEditor(type, item, row) {
  const previous = row.querySelector(".inline-edit");
  if (previous) { previous.remove(); return; }
  const editor = document.createElement("form");
  editor.className = "inline-edit";
  for (const [field, labelText, kind, opts] of RECORD_FIELDS[type]) {
    const label = document.createElement("label");
    label.textContent = labelText;
    let input;
    if (kind === "textarea") input = document.createElement("textarea");
    else if (kind === "select" || kind === "clients" || kind === "cases") {
      input = document.createElement("select");
      const options = kind === "clients" ? [["", "Sem vínculo"], ...state.clients.map((c) => [c.id, c.name])]
        : kind === "cases" ? [["", "Sem vínculo"], ...state.cases.map((c) => [c.id, c.title])]
        : opts.map((v) => [v, ({pf:"Pessoa física",pj:"Pessoa jurídica",true:"Concluído",false:"Pendente"})[v] || v]);
      for (const [value,text] of options) input.add(new Option(text,value));
    } else {
      input = document.createElement("input");
      input.type = kind;
    }
    input.name = field;
    const value = item[field] ?? "";
    input.value = kind === "datetime-local" ? localDateTime(value) : String(value);
    if (["name", "title", "starts_at"].includes(field)) input.required = true;
    label.append(input);
    editor.append(label);
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const save = document.createElement("button");
  save.type = "submit"; save.textContent = "Salvar alterações";
  actions.append(save, createButton("Cancelar", () => editor.remove()));
  editor.append(actions);
  editor.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    const values = formValues(editor, RECORD_FIELDS[type].map(([field]) => field));
    if (type === "movements") values.happened_at = new Date(values.happened_at).toISOString();
    if (type === "events") {
      values.completed = values.completed === "true";
      values.starts_at = new Date(values.starts_at).toISOString();
    }
    try { await updateRecord(TABLES[type], item.id, values); }
    catch (error) { feedback(error.message); }
    finally { save.disabled = false; }
  });
  row.append(editor);
}

async function updateRecord(table, id, value) {
  await api("/" + table + "?id=eq." + encodeURIComponent(id), { method: "PATCH", body: value });
  await reloadData();
  feedback("Registro atualizado.");
}

async function removeRecord(type, item) {
  const table = TABLES[type];
  if (type === "documents") {
    const encoded = item.storage_path.split("/").map(encodeURIComponent).join("/");
    // Exclui primeiro o objeto; se a exclusão do registro falhar, ele continua visível para nova tentativa.
    await api("/object/legal-private/" + encoded, { method: "DELETE", storage: true });
  }
  await api("/" + table + "?id=eq." + encodeURIComponent(item.id), { method: "DELETE" });
  await reloadData();
  feedback("Registro excluído.");
}

function fillSelect(id, items, label) {
  const select = $(id);
  const prior = select.value;
  select.replaceChildren(new Option("Sem vínculo", ""));
  for (const item of items) select.add(new Option(label(item), item.id));
  select.value = items.some((item) => item.id === prior) ? prior : "";
}

function render() {
  $("count-clients").textContent = state.clients.length;
  $("count-cases").textContent = state.cases.filter((item) => item.status === "ativo").length;
  $("count-events").textContent = state.events.filter((item) => !item.completed && new Date(item.starts_at) >= new Date()).length;
  $("count-documents").textContent = state.documents.length;
  fillSelect("case-client", state.clients, (item) => item.name);
  fillSelect("document-case", state.cases, (item) => item.title);
  fillSelect("event-case", state.cases, (item) => item.title);
  fillSelect("movement-case", state.cases, (item) => item.title);
  const c = searchable(state.clients, "client-search", ["name","document","email","phone"]);
  const cases = searchable(state.cases, "case-search", ["title","cnj","court","status"]);
  const documents = searchable(state.documents, "document-search", ["name","mime_type"]);
  const events = searchable(state.events, "event-search", ["title","kind","starts_at"]);
  const movements = searchable(state.movements.map((item) => ({ ...item, case_title: state.cases.find((c) => c.id === item.case_id)?.title || "" })), "movement-search", ["title","details","case_title"]);
  const now = Date.now();
  const upcoming = [...state.events].filter((e) => !e.completed)
    .sort((a,b) => new Date(a.starts_at) - new Date(b.starts_at)).slice(0, 12);
  const describeEvent = (item) => (new Date(item.starts_at).toLocaleString("pt-BR") + " · " + item.title + " · " + item.kind + (item.completed ? " · Concluído" : ""));
  const isOverdue = (item) => !item.completed && new Date(item.starts_at).getTime() < now;
  itemList("upcoming-list",upcoming,describeEvent,{overdue:isOverdue,complete:true,edit:"events"});
  itemList("client-list",c,(item) => item.name + " · " + (item.kind === "pj" ? "Pessoa jurídica" : "Pessoa física"),{edit:"clients"});
  itemList("case-list",cases,(item) => item.title + " · " + item.status + (item.cnj ? " · " + item.cnj : ""),{edit:"cases"});
  itemList("event-list",events.filter((item)=> !agendaPendingOnly || !item.completed),describeEvent,{complete:true,edit:"events",overdue:isOverdue});
  itemList("document-list",documents,(item) => item.name,{open:openDocument,remove:"documents"});
  itemList("movement-list",movements,(item) => new Date(item.happened_at).toLocaleString("pt-BR") + " · " + item.case_title + " · " + item.title,{edit:"movements"});
  const entityNames = { clients:"cliente",cases:"processo",events:"compromisso",documents:"documento",movements:"movimentação" };
  const actionNames = { INSERT:"Criou",UPDATE:"Atualizou",DELETE:"Excluiu" };
  itemList("audit-list",state.audits.slice(0,20), (item) =>
    new Date(item.created_at).toLocaleString("pt-BR") + " · " +
    (actionNames[item.action] || "Alterou") + " · " +
    (entityNames[item.entity_type] || "registro"));

}

async function openDocument(item) {
  const encoded = item.storage_path.split("/").map(encodeURIComponent).join("/");
  const blob = await api(`/object/authenticated/legal-private/${encoded}`, { storage: true });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = item.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}

async function reloadData() {
  const version = sessionVersion;
  const rows = await Promise.all(Object.entries(TABLES).map(async ([key, name]) => {
    const order = key === "events" ? "starts_at.asc" : key === "movements" ? "happened_at.desc" : "created_at.desc";
    const values = await api(`/${name}?select=*&order=${order}&limit=200`);
    if (!Array.isArray(values)) throw new Error(UNAVAILABLE);
    return [key, values];
  }));
  if (version !== sessionVersion) throw new Error(SESSION_ENDED);
  Object.assign(state, Object.fromEntries(rows));
  render();
}

function formValues(form, fields) {
  const data = new FormData(form);
  return Object.fromEntries(fields.map((field) => [field, String(data.get(field) || "").trim() || null]));
}

async function insert(table, value) {
  await api(`/${table}`, { method: "POST", body: value });
  await reloadData();
  feedback("Registro salvo com sucesso.");
}

function bindForm(id, table, fields, transform = (record) => record) {
  $(id).addEventListener("submit", async (event) => {
    event.preventDefault();
    feedback("");
    const form = event.currentTarget;
    const button = form.querySelector("button[type=submit],button:not([type])");
    button.disabled = true;
    try {
      await insert(table, transform(formValues(form, fields)));
      form.reset();
    } catch (error) { feedback(error.message); }
    finally { button.disabled = false; }
  });
}

// Convites e recuperações Supabase entregam tokens na fragment URL.
// Não persistir tokens em storage ou logs; removê-los imediatamente da URL.
function consumeAuthRedirect() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const type = hash.get("type");
  const token = hash.get("access_token");
  const renewal = hash.get("refresh_token");
  const issue = hash.get("error_description") || hash.get("error_code");
  const query = new URLSearchParams(location.search);
  const sensitive = ["access_token", "refresh_token", "token", "token_hash", "code", "error", "error_description", "error_code"];
  const queryAuth = sensitive.some((key) => query.has(key));
  if (!sensitive.some((key) => hash.has(key)) && !queryAuth) return false;
  for (const key of sensitive) query.delete(key);
  history.replaceState(null, "", location.pathname + (query.toString() ? "?" + query.toString() : ""));
  if (issue || hash.has("error") || queryAuth) {
    feedback("O link expirou ou não pôde ser validado. Solicite um novo convite ou recuperação de senha.");
    return true;
  }
  if (!["invite", "recovery"].includes(type) || !token || !renewal) {
    feedback("Link de autenticação não reconhecido. Solicite uma recuperação de senha.");
    return true;
  }
  accessToken = token;
  refreshToken = renewal;
  try { tokenExpiresAt = expiresAt(hash.get("expires_in")); }
  catch { logout(); feedback("O link expirou ou é inválido. Solicite um novo convite ou recuperação."); return true; }
  currentUser = null;
  $("login-panel").hidden = true;
  $("recover-panel").hidden = true;
  $("workspace").hidden = true;
  $("password-panel").hidden = false;
  $("page-title").textContent = "Criar senha de acesso";
  return true;
}

$("password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback("");
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const password = form.elements.password.value;
  if (password.length > 128 || password.length < 12 || password !== form.elements.confirm.value) {
    feedback("A senha deve ter pelo menos 12 caracteres e os dois campos devem coincidir.");
    return;
  }
  if (!settings || !accessToken) {
    feedback("Link de convite ou recuperação inválido. Solicite um novo.");
    return;
  }
  const done = authBusy(button, "Salvando senha…");
  try {
    const response = await request(settings.url + "/auth/v1/user", {
      method: "PUT",
      headers: {
        apikey: settings.publishableKey,
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ password }),
      cache: "no-store"
    });
    if (response.status >= 500) throw new Error(UNAVAILABLE);
    if (!response.ok) throw new Error("Não foi possível definir a senha. O convite pode ter expirado.");
    form.reset();
    logout();
    $("password-panel").hidden = true;
    feedback("Senha definida! Agora entre com seu e-mail e a nova senha.");
  } catch (error) { feedback(error.message); }
  finally { done(); }
});

$("open-recover").addEventListener("click", () => {
  feedback("");
  $("login-panel").hidden = true;
  $("recover-panel").hidden = false;
  $("page-title").textContent = "Recuperar acesso";
});
$("back-login").addEventListener("click", () => {
  feedback("");
  $("recover-panel").hidden = true;
  $("login-panel").hidden = false;
  $("page-title").textContent = "Acesso ao escritório";
});
$("recover-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const done = authBusy(button, "Solicitando link…");
  feedback("");
  try {
    if (!settings) throw new Error("Serviço de autenticação indisponível.");
    if (Date.now() < recoveryRetryAt) throw new Error("Aguarde antes de solicitar outro e-mail de recuperação.");
    const response = await request(settings.url + "/auth/v1/recover?redirect_to=" +
      encodeURIComponent(location.origin + "/juridico/portal"), {
        method: "POST",
        headers: { apikey: settings.publishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.elements.email.value.trim() }),
        cache: "no-store"
      });
    // Nunca indicar envio quando Supabase devolveu 429.
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const delay = Number(retry) * 1000 || Date.parse(retry) - Date.now() || 60000;
      recoveryRetryAt = Date.now() + Math.max(60000, delay);
      throw new Error("O Supabase atingiu o limite temporário de envios de e-mail. Aguarde a liberação do serviço antes de solicitar novamente.");
    }
    if (response.status >= 500) throw new Error(UNAVAILABLE);
    // Resposta genérica em caso de sucesso para impedir enumeração de contas.
    if (!response.ok) {
      throw new Error("Não foi possível solicitar o link. Confira a configuração de redirecionamento no Supabase.");
    }
    form.reset();
    feedback("Solicitação aceita. Se o e-mail estiver cadastrado, verifique a caixa de entrada e o spam.");
  } catch (error) { feedback(error.message); }
  finally { done(); }
});

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback("");
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const done = authBusy(button, "Entrando…");
  const version = sessionVersion;
  try {
    if (!settings) throw new Error(UNAVAILABLE);
    const body = { email: form.elements.email.value.trim(), password: form.elements.password.value };
    const response = await request(settings.url + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: settings.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
    const data = await authData(response);
    if (version !== sessionVersion) throw new Error(SESSION_ENDED);
    if (!response.ok || !data.access_token || !data.refresh_token || !data.user?.id) throw new Error("Não foi possível entrar. Verifique as credenciais.");
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiresAt = expiresAt(data.expires_in);
    currentUser = data.user.id;
    form.reset();
    const membership = await api("/legal_access?select=enabled,role&user_id=eq." + encodeURIComponent(currentUser));
    if (!Array.isArray(membership) || !membership.some((entry) => entry.enabled === true)) {
      throw new Error("Esta conta ainda não foi autorizada para acessar o escritório.");
    }
    await reloadData();
    if (version !== sessionVersion) throw new Error(SESSION_ENDED);
    $("login-panel").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    show("dashboard");
  } catch (error) {
    if (version === sessionVersion) { logout(); feedback(error.message); }
  }
  finally { done(); }
});

$("logout").addEventListener("click", async () => {
  const token = accessToken;
  logout();
  feedback("Sessão local encerrada.");
  if (token && settings) {
    try {
      const response = await request(settings.url + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: settings.publishableKey, Authorization: "Bearer " + token },
        cache: "no-store",
      });
      if (!response.ok) feedback("Você saiu deste navegador, mas não foi possível revogar a sessão remota.");
    } catch { feedback("Você saiu deste navegador, mas não foi possível confirmar a revogação remota."); }
  }
});
for (const link of document.querySelectorAll("[data-view]")) link.addEventListener("click", (event) => {
  event.preventDefault();
  if (accessToken) { show(link.dataset.view); feedback(""); }
});

for (const id of ["client-search","case-search","document-search","event-search","movement-search"])
  $(id).addEventListener("input",render);
for (const [id,pending] of [["show-pending",true],["show-all",false]]) {
  $(id).addEventListener("click",() => {
    agendaPendingOnly = pending;
    for (const key of ["show-pending","show-all"]) {
      const active = key === id;
      $(key).classList.toggle("active",active);
      $(key).setAttribute("aria-pressed",String(active));
    }
    render();
  });
}

bindForm("movement-form", "legal_movements", ["case_id","title","happened_at","details"], (record) => ({
  ...record, happened_at: new Date(record.happened_at).toISOString(),
}));
bindForm("client-form", "legal_clients", ["kind", "name", "document", "email", "phone", "notes"]);
bindForm("case-form", "legal_cases", ["title", "cnj", "court", "client_id", "status", "notes"]);
bindForm("event-form", "legal_events", ["title", "kind", "starts_at", "case_id", "notes"], (record) => ({
  ...record, starts_at: new Date(record.starts_at).toISOString(),
}));

$("document-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback("");
  const form = event.currentTarget;
  const button = form.querySelector("button");
  const version = sessionVersion;
  button.disabled = true;
  try {
    const file = form.elements.file.files[0];
    const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
    if (!file || file.size < 1 || file.size > 10485760 || !allowed.has(file.type)) throw new Error("Arquivo inválido ou maior que 10 MB.");
    const ext = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" }[file.type];
    const key = `${currentUser}/${crypto.randomUUID()}.${ext}`;
    await api(`/object/legal-private/${key}`, { method: "POST", storage: true, body: file });
    if (version !== sessionVersion) return;
    try {
      await api("/legal_documents", { method: "POST", body: { name: file.name.slice(0, 200), storage_path: key, size_bytes: file.size, mime_type: file.type, case_id: form.elements.case_id.value || null } });
    } catch (error) {
      // Se o servidor pode ter gravado os metadados, não apagar o objeto confirmado.
      if (version === sessionVersion && !error.uncertainWrite)
        await api(`/object/legal-private/${key}`, { method: "DELETE", storage: true }).catch(() => {});
      throw error;
    }
    if (version !== sessionVersion) return;
    form.reset();
    // Falha de leitura posterior não desfaz upload/metadados já confirmados.
    try {
      await reloadData();
      if (version === sessionVersion) feedback("Registro salvo com sucesso.");
    }
    catch { if (version === sessionVersion) feedback("Documento salvo, mas não foi possível atualizar a lista. Confira os registros antes de reenviar."); }
  } catch (error) { if (version === sessionVersion) feedback(error.message); }
  finally { if (version === sessionVersion) button.disabled = false; }
});

// Limpar o fragmento antes de qualquer espera de rede, inclusive se a configuração falhar.
const hasAuthRedirect = consumeAuthRedirect();
(async () => {
  try {
    const response = await request("/api/juridico/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Integração privada não configurada.");
    settings = await response.json();
    if (!hasAuthRedirect || !accessToken) $("login-panel").hidden = false;
  } catch { logout(); $("setup").hidden = false; feedback(UNAVAILABLE); }
})();
