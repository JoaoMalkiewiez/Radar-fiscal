"use strict";
// Leitor local do CSV oficial SNCR: não envia arquivos para qualquer servidor.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RuralCsv = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function normalize(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("pt-BR").replace(/\s+/g, " ").trim();
  }
  function parseCsv(text) {
    if (typeof text !== "string" || text.length > 10_000_000) throw new Error("Arquivo muito grande.");
    const result = [];
    let line = [], field = "", quote = false;
    const source = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < source.length; i++) {
      const c = source[i];
      if (c === '"') {
        if (quote && source[i + 1] === '"') { field += '"'; i++; }
        else quote = !quote;
      } else if (c === ";" && !quote) { line.push(field.trim()); field = ""; }
      else if ((c === "\n" || c === "\r") && !quote) {
        if (c === "\r" && source[i + 1] === "\n") i++;
        line.push(field.trim());
        if (line.some(Boolean)) result.push(line);
        line = []; field = "";
      } else field += c;
    }
    if (quote) throw new Error("CSV inválido: aspas não fechadas.");
    line.push(field.trim());
    if (line.some(Boolean)) result.push(line);
    return result;
  }
  const synonyms = {
    holder: ["titular", "nome do titular", "detentor", "nome do detentor"],
    code: ["codigo do imovel", "codigo imovel", "codigo sncr", "codigo do imovel rural"],
    name: ["denominacao", "denominacao do imovel", "nome do imovel", "imovel rural"],
    city: ["municipio", "municipio sede do imovel", "municipio sede"],
    state: ["uf", "unidade da federacao", "estado"],
    area: ["area total", "area total (ha)", "area total em hectares", "area total ha"],
    relation: ["condicao da pessoa", "condicao do titular", "condicao de pessoa", "condicao"],
    share: ["percentual de detencao", "percentual detencao", "participacao"]
  };
  function columns(header) {
    const normalized = header.map(normalize);
    const found = {};
    for (const [key, options] of Object.entries(synonyms)) {
      const at = normalized.findIndex((value) => options.some((option) => value === option || value.startsWith(option + " (")));
      if (at >= 0) found[key] = at;
    }
    // Sem coluna titular não é possível atribuir um vínculo com segurança.
    if (found.holder === undefined || found.name === undefined) {
      throw new Error("O CSV não apresenta as colunas de Titular e Denominação do Imóvel reconhecidas. Confira o arquivo oficial.");
    }
    return found;
  }
  function search(text, holder) {
    const rows = parseCsv(text);
    if (!rows.length) throw new Error("CSV vazio.");
    const map = columns(rows[0]);
    const term = normalize(holder);
    if (term.length < 3) throw new Error("Informe o nome completo para comparar.");
    const result = [];
    for (const cells of rows.slice(1)) {
      if (normalize(cells[map.holder]) !== term) continue;
      const get = (key) => map[key] === undefined ? "" : String(cells[map[key]] ?? "").slice(0, 250);
      result.push({
        holder: get("holder"), name: get("name"), code: get("code"),
        city: get("city"), state: get("state"), area: get("area"),
        relation: get("relation"), share: get("share"),
      });
    }
    return { matches: result, searchedRows: Math.max(0, rows.length - 1) };
  }
  return { normalize, parseCsv, search };
});
