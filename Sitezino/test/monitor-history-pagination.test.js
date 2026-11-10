"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

function excerpt(from, to) {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a);
  assert.ok(a >= 0 && b > a, "Trecho do Monitor SEFAZ deve existir");
  return source.slice(a, b);
}

function createHarness() {
  // Exercita as funções reais do frontend com elementos DOM simulados, sem rede.
  const script = [
    'const MONITOR_DOCS = ["nfe","nfce","cte"];',
    'const MONITOR_DOC_LABELS = {nfe:"NF-e",nfce:"NFC-e",cte:"CT-e"};',
    'const MONITOR_HISTORY_SEVERITY = {3:{label:"Muito lento",tone:"vslow"}};',
    'const MONITOR_HISTORY_PAGE_SIZE = 5;',
    'let monitorHistoryVisibleCount = MONITOR_HISTORY_PAGE_SIZE;',
    'const SEFAZ = {SC:{name:"Santa Catarina"},SP:{name:"São Paulo"}};',
    'const monitorHistoryFilters = {period:"7d",document:"all",uf:"all",state:"all"};',
    'const monitorHistoryState = {data:null,loading:false,error:null};',
    'const nodes = new Map();',
    'const $ = selector => { if(!nodes.has(selector)) nodes.set(selector,{hidden:false,textContent:"",innerHTML:"",dataset:{ready:"true"},value:"",classList:{toggle(){}},setAttribute(){},scrollIntoView(){}}); return nodes.get(selector); };',
    'const $$ = () => [];',
    'const escapeHTML = String;',
    'const ensureMonitorHistoryUFOptions = () => {};',
    'const renderMonitorHistoryChart = () => {};',
    excerpt("function monitorHistoryDate(value)", "function ensureMonitorHistoryUFOptions()"),
    excerpt("function monitorHistoryWindow(period", "function renderMonitorHistoryChart("),
    excerpt("function renderMonitorHistory()", "async function loadMonitorHistory("),
    "return { $, monitorHistoryState, monitorHistoryFilters, renderMonitorHistory, setCount(value){monitorHistoryVisibleCount=value;}, resetCount(){monitorHistoryVisibleCount=5;} };",
  ].join("\n");
  return new Function(script)();
}

function numberShown(view) {
  const html = view.$("#monitor-history-list").innerHTML;
  return (html.match(/<article class="monitor-history-item"/g) || []).length;
}

test("o histórico mostra apenas 5 ocorrências e permite expandir ou recolher", () => {
  const view = createHarness();
  const now = Date.now();
  view.monitorHistoryState.data = {
    incidents: Array.from({ length: 15 }, (_, i) => ({
      document: "nfe", uf: i < 10 ? "SC" : "SP",
      detectedAt: new Date(now - (i + 1) * 30 * 60 * 1000).toISOString(),
      recoveredAt: null, durationSeconds: 0, maxSeverity: 3,
    })),
  };
  view.renderMonitorHistory();
  assert.equal(numberShown(view), 5);
  assert.match(view.$("#monitor-history-results-count").textContent, /Exibindo 5 de 15/);
  assert.equal(view.$("#monitor-history-more").hidden, false);
  assert.equal(view.$("#monitor-history-less").hidden, true);

  view.setCount(10);
  view.renderMonitorHistory();
  assert.equal(numberShown(view), 10);
  assert.equal(view.$("#monitor-history-less").hidden, false);

  view.resetCount();
  view.renderMonitorHistory();
  assert.equal(numberShown(view), 5);
});

test("filtro por estado respeita últimas 5 e oculta Ver mais quando não há mais registros", () => {
  const view = createHarness();
  const now = Date.now();
  view.monitorHistoryState.data = {
    incidents: Array.from({ length: 15 }, (_, i) => ({
      document: "nfce", uf: i < 10 ? "SC" : "SP",
      detectedAt: new Date(now - (i + 1) * 20 * 60 * 1000).toISOString(),
      recoveredAt: null, durationSeconds: 0, maxSeverity: 3,
    })),
  };
  view.monitorHistoryFilters.uf = "SP";
  view.renderMonitorHistory();
  assert.equal(numberShown(view), 5);
  assert.equal(view.$("#monitor-history-more").hidden, true);
  assert.match(view.$("#monitor-history-results-count").textContent, /Exibindo 5 de 5/);

  view.monitorHistoryFilters.uf = "SC";
  view.resetCount();
  view.renderMonitorHistory();
  assert.equal(numberShown(view), 5);
  assert.equal(view.$("#monitor-history-more").hidden, false);
  view.setCount(10);
  view.renderMonitorHistory();
  assert.equal(numberShown(view), 10);
  assert.equal(view.$("#monitor-history-more").hidden, true);
});

test("controles de expansão ficam na página e o histórico usa paginação de 5", () => {
  assert.match(html, /id="monitor-history-more"/);
  assert.match(html, /id="monitor-history-less"/);
  assert.match(html, /id="monitor-history-pagination"/);
  assert.match(source, /const MONITOR_HISTORY_PAGE_SIZE = 5;/);
  assert.match(source, /incidents\.slice\(0, monitorHistoryVisibleCount\)/);
});
