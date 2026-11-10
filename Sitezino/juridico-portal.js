"use strict";

// Sem dados pessoais em localStorage, sessionStorage ou logs.
// Toda autorização de registros e arquivos é aplicada pelas políticas RLS do banco.
let settings = null;
let accessToken = null;
let currentUser = null;
const state = { clients: [], cases: [], events: [], documents: [] };
const $ = (id) => document.getElementById(id);

function feedback(message) {
  const node = $("feedback");
  node.textContent = message;
  node.hidden = !message;
}

async function api(path, { method = "GET", body, storage = false } = {}) {
  if (!settings || !accessToken) throw new Error("Faça login para continuar.");
  const headers = { apikey: settings.publishableKey, Authorization: `Bearer ${accessToken}` };
  if (!storage && body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(settings.url + (storage ? "/storage/v1" : "/rest/v1") + path, {
    method, headers, body: storage ? body : body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
  });
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

function itemList(target, values, makeLabel, action) {
  const box = $(target);
  box.replaceChildren();
  if (!values.length) {
    const empty = document.createElement("p");
    empty.textContent = "Nenhum registro cadastrado.";
    box.append(empty);
    return;
  }
  for (const item of values) {
    const row = document.createElement("div");
    row.className = "module";
    const title = document.createElement("span");
    title.textContent = makeLabel(item);
    title.style.flex = "1";
    row.append(title);
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Abrir";
      button.addEventListener("click", () => action(item).catch((error) => feedback(error.message)));
      row.append(button);
    }
    box.append(row);
  }
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
  itemList("client-list", state.clients, (item) => `${item.name} · ${item.kind === "pj" ? "Pessoa jurídica" : "Pessoa física"}`);
  itemList("case-list", state.cases, (item) => `${item.title} · ${item.status} ${item.cnj ? "· " + item.cnj : ""}`);
  itemList("event-list", state.events, (item) => `${new Date(item.starts_at).toLocaleString("pt-BR")} · ${item.title} · ${item.kind}`);
  itemList("document-list", state.documents, (item) => item.name, openDocument);
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
  const tables = { clients: "legal_clients", cases: "legal_cases", events: "legal_events", documents: "legal_documents" };
  await Promise.all(Object.entries(tables).map(async ([key, name]) => {
    const order = key === "events" ? "starts_at.asc" : "created_at.desc";
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
    if (!response.ok || !data.access_token) throw new Error("Não foi possível entrar. Verifique as credenciais.");
    accessToken = data.access_token;
    currentUser = data.user?.id;
    form.reset();
    await reloadData();
    $("login-panel").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    show("dashboard");
  } catch (error) { logout(); feedback(error.message); }
  finally { button.disabled = false; }
});

$("logout").addEventListener("click", () => { logout(); feedback("Sessão encerrada neste navegador."); });
for (const link of document.querySelectorAll("[data-view]")) link.addEventListener("click", (event) => {
  event.preventDefault();
  if (accessToken) { show(link.dataset.view); feedback(""); }
});

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
