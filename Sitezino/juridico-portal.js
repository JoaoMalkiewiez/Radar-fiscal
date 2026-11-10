"use strict";

// Sem dados pessoais em localStorage, sessionStorage ou logs.
// Toda autorização de registros e arquivos é aplicada pelas políticas RLS do banco.
let settings = null;
let accessToken = null;
let refreshToken = null;
let tokenExpiresAt = 0;
let currentUser = null;
let refreshInFlight = null;
const state = { clients: [], cases: [], events: [], documents: [], movements: [] };
const $ = (id) => document.getElementById(id);

function feedback(message) {
  const node = $("feedback");
  node.textContent = message;
  node.hidden = !message;
}

async function refreshAccessToken() {
  if (!settings || !refreshToken) throw new Error("Sessão expirada. Entre novamente.");
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const response = await fetch(settings.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST", headers: { apikey: settings.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }), cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.access_token || !data.refresh_token || data.user?.id !== currentUser)
      throw new Error("Sessão expirada. Entre novamente.");
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiresAt = Date.now() + Math.max(30, data.expires_in || 3600) * 1000;
  })();
  try { await refreshInFlight; }
  catch (error) { logout(); throw error; }
  finally { refreshInFlight = null; }
}

async function api(path, { method = "GET", body, storage = false, retry = true } = {}) {
  if (!settings || !accessToken) throw new Error("Faça login para continuar.");
  if (Date.now() + 30000 >= tokenExpiresAt) await refreshAccessToken();
  const headers = { apikey: settings.publishableKey, Authorization: `Bearer ${accessToken}` };
  if (!storage && body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(settings.url + (storage ? "/storage/v1" : "/rest/v1") + path, {
    method, headers, body: storage ? body : body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
  });
  if (response.status === 401 && retry) {
    await refreshAccessToken();
    return api(path, { method, body, storage, retry: false });
  }
  if (response.status === 401) {
    logout();
    throw new Error("Sessão expirada. Entre novamente.");
  }
  if (!response.ok) throw new Error(`Operação não concluída (${response.status}). Verifique suas permissões.`);
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") || "";
  return type.includes("json") ? response.json() : response.blob();
}

function logout() {
  accessToken = null;
  refreshToken = null;
  tokenExpiresAt = 0;
  currentUser = null;
  for (const key of Object.keys(state)) state[key] = [];
  $("workspace").hidden = true;
  $("login-panel").hidden = !settings;
  $("logout").hidden = true;
  $("page-title").textContent = "Acesso ao escritório";
}

function show(view) {
  for (const node of document.querySelectorAll(".view")) node.hidden = node.id !== view;
  for (const link of document.querySelectorAll("[data-view]")) link.classList.toggle("active", link.dataset.view === view);
  const names = { dashboard: "Visão geral", clients: "Clientes", cases: "Processos", documents: "Documentos", events: "Agenda e prazos" };
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
const TABLES = { clients: "legal_clients", cases: "legal_cases", events: "legal_events", documents: "legal_documents", movements: "legal_movements" };
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
  const tables = TABLES;
  await Promise.all(Object.entries(tables).map(async ([key, name]) => {
    const order = key === "events" ? "starts_at.asc" : key === "movements" ? "happened_at.desc" : "created_at.desc";
    state[key] = await api(`/${name}?select=*&order=${order}&limit=200`);
  }));
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

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback("");
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const body = { email: form.elements.email.value, password: form.elements.password.value };
    const response = await fetch(settings.url + "/auth/v1/token?grant_type=password", {
      method: "POST", headers: { apikey: settings.publishableKey, "Content-Type": "application/json" },
      body: JSON.stringify(body), cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok || !data.access_token || !data.refresh_token || !data.user?.id) throw new Error("Não foi possível entrar. Verifique as credenciais.");
    accessToken = data.access_token;
    refreshToken = data.refresh_token;
    tokenExpiresAt = Date.now() + Math.max(30, data.expires_in || 3600) * 1000;
    currentUser = data.user.id;
    form.reset();
    const membership = await api("/legal_access?select=enabled,role&user_id=eq." + encodeURIComponent(currentUser));
    if (!Array.isArray(membership) || !membership.some((entry) => entry.enabled)) {
      throw new Error("Esta conta ainda não foi autorizada para acessar o escritório.");
    }
    await reloadData();
    $("login-panel").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    show("dashboard");
  } catch (error) { logout(); feedback(error.message); }
  finally { button.disabled = false; }
});

$("logout").addEventListener("click", async () => {
  const token = accessToken;
  logout();
  feedback("Sessão local encerrada.");
  if (token && settings) {
    try {
      const response = await fetch(settings.url + "/auth/v1/logout", {
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
  button.disabled = true;
  try {
    const file = form.elements.file.files[0];
    const allowed = new Set(["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
    if (!file || file.size < 1 || file.size > 10485760 || !allowed.has(file.type)) throw new Error("Arquivo inválido ou maior que 10 MB.");
    const ext = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx" }[file.type];
    const key = `${currentUser}/${crypto.randomUUID()}.${ext}`;
    await api(`/object/legal-private/${key}`, { method: "POST", storage: true, body: file });
    try {
      await insert("legal_documents", { name: file.name.slice(0, 200), storage_path: key, size_bytes: file.size, mime_type: file.type, case_id: form.elements.case_id.value || null });
    } catch (error) {
      await api(`/object/legal-private/${key}`, { method: "DELETE", storage: true }).catch(() => {});
      throw error;
    }
    form.reset();
  } catch (error) { feedback(error.message); }
  finally { button.disabled = false; }
});

(async () => {
  try {
    const response = await fetch("/api/juridico/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Integração privada não configurada.");
    settings = await response.json();
    $("login-panel").hidden = false;
  } catch { $("setup").hidden = false; }
})();
