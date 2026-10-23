"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const siteRoot = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(siteRoot, name), "utf8");

const EXPECTED_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO",
  "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI",
  "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

test("mapa SVG possui as 27 UFs, uma vez cada, com nome e área selecionável", () => {
  const html = read("index.html");
  const app = read("app.js");
  const mapGroups = [
    ...html.matchAll(
      /<g class="monitor-map-state [^"]*" data-map-uf="([A-Z]{2})" data-map-name="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g
    ),
  ].map((match) => ({ uf: match[1], name: match[2], opening: match[0].slice(0, match[0].indexOf(">") + 1), markup: match[3] }));

  const counts = new Map();
  for (const item of mapGroups) counts.set(item.uf, (counts.get(item.uf) || 0) + 1);
  assert.equal(mapGroups.length, 27, "esperava exatamente 27 grupos de estados");
  assert.deepEqual(
    [...counts.entries()].filter(([, count]) => count !== 1),
    [],
    "cada UF deve aparecer uma única vez"
  );
  assert.deepEqual([...counts.keys()].sort(), [...EXPECTED_UFS].sort());

  const sefazBlock = app.match(/const SEFAZ = \{([\s\S]*?)\n\};/);
  assert.ok(sefazBlock, "objeto SEFAZ não encontrado");
  const appStates = [
    ...sefazBlock[1].matchAll(/^\s{2}([A-Z]{2}): \{ name: "([^"]+)"/gm),
  ].map((match) => ({ uf: match[1], name: match[2] }));
  assert.deepEqual(appStates.map((item) => item.uf).sort(), [...EXPECTED_UFS].sort());

  for (const group of mapGroups) {
    const state = appStates.find((item) => item.uf === group.uf);
    assert.ok(state, `UF ${group.uf} não existe no objeto SEFAZ`);
    assert.equal(group.name, state.name, `nome divergente para ${group.uf}`);
    assert.match(group.markup, /<path\b/, `UF ${group.uf} não tem forma clicável`);
    assert.match(
      group.markup,
      new RegExp(`<text\\b[^>]*>\\s*${group.uf}\\s*<\\/text>`),
      `sigla visível incorreta para ${group.uf}`
    );
    assert.match(group.opening, /role="button"/);
    assert.match(group.opening, /tabindex="0"/);
  }
});

test("NF-e, NFC-e e CT-e têm mapeamento de cor para cada status recebido", () => {
  const app = read("app.js");
  const css = read("styles.css");
  const documents = app.match(/const MONITOR_DOCS = \[([^\]]+)\]/);
  assert.ok(documents, "lista de documentos não encontrada");
  assert.deepEqual(
    [...documents[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]),
    ["nfe", "nfce", "cte"]
  );

  const statusBlock = app.match(/const MONITOR_STATUS = \{([\s\S]*?)\n\};/);
  const paletteBlock = app.match(/const MONITOR_MAP_PALETTE = \{([\s\S]*?)\n\};/);
  assert.ok(statusBlock, "tabela de status não encontrada");
  assert.ok(paletteBlock, "paleta do mapa não encontrada");
  const statuses = new Map(
    [...statusBlock[1].matchAll(/^\s{2}(\d): \{ label: "([^"]+)", tone: "([^"]+)"/gm)]
      .map((match) => [Number(match[1]), { label: match[2], tone: match[3] }])
  );
  const tones = new Set(
    [...paletteBlock[1].matchAll(/^\s{2}([a-z]+): \{ fill:/gm)].map((match) => match[1])
  );

  assert.deepEqual([...statuses.keys()].sort(), [0, 1, 2, 3, 4, 5]);
  for (const [code, expectedTone] of [
    [0, "none"],
    [1, "normal"],
    [2, "slow"],
    [3, "vslow"],
    [4, "error"],
    [5, "timeout"],
  ]) {
    assert.equal(statuses.get(code).tone, expectedTone, `cor incorreta para status ${code}`);
    assert.ok(tones.has(expectedTone), `sem cor definida para o tom ${expectedTone}`);
  }

  assert.match(app, /const states = monitor\.data\?\.docs\?\.\[monitor\.doc\] \|\| \{\}/);
  assert.match(app, /const palette = MONITOR_MAP_PALETTE\[info\.tone\]/);
  assert.match(app, /const statePaths = \$\$\("path", node\)/);
  assert.match(app, /statePaths\.forEach\(\(statePath\) => \{/);
  assert.match(app, /statePath\.style\.setProperty\("fill", palette\.fill, "important"\)/);
  assert.match(css, /\.monitor-map-state:hover path \{[\s\S]*?filter: drop-shadow/);
  assert.doesNotMatch(
    css.match(/\.monitor-map-state:hover path \{([^}]+)\}/)?.[1] || "",
    /fill\s*:/,
    "hover não pode substituir a cor que representa o status"
  );
});

test("coleta cada documento com o worker de referência e rejeita resposta sem UFs", () => {
  const server = read("server.js");
  const request = server.match(/const url = `([^`]+)`;/);
  assert.ok(request, "URL de coleta não encontrada");
  assert.match(
    request[1],
    /\/monitores\?stateStatus=true&doc=\$\{encodeURIComponent\(doc\)\}&worker_id=sefaz_\$\{doc\}_envio_sp/
  );
  assert.match(server, /sefaz_\(nfe\|nfce\|cte\)_envio_\(\[a-z\]\{2\}\)/);
  assert.match(server, /if \(Object\.keys\(states\)\.length === 0\)/);
  assert.match(server, /A fonte não retornou status estaduais reconhecíveis/);
});
