"use strict";
// Consulta cadastral real, sem inferência ou promessa de localização de bens.
(function () {
  const get = (id) => document.getElementById(id);
  function el(tag, text, className) {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (className) n.className = className;
    return n;
  }
  function line(parent, label, value) {
    if (value === null || value === undefined || value === "") return;
    const p = el("p");
    p.append(el("strong", label + ": "), document.createTextNode(String(value)));
    parent.append(p);
  }
  function note(parent, text) { parent.append(el("p", text, "investigation-note")); }
  function source(parent, title, href) {
    const a = el("a", title);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    parent.append(a);
  }
  function safe(value) { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
  function showCompany(payload) {
    const box = get("investigation-result");
    box.replaceChildren();
    const company = payload && payload.brasil;
    const alternatives = payload && payload.ie;
    if (!company && !alternatives) {
      note(box, "As fontes não retornaram informações nesta tentativa. Resultado inconclusivo; não significa que o CNPJ inexiste.");
      return;
    }
    const article = el("article", null, "investigation-card");
    article.append(el("h3", safe(company?.razao_social) || "Registro empresarial consultado"));
    line(article, "CNPJ", safe(payload.cnpj));
    line(article, "Nome fantasia", safe(company?.nome_fantasia));
    line(article, "Situação cadastral", safe(company?.descricao_situacao_cadastral));
    line(article, "Abertura", safe(company?.data_inicio_atividade));
    line(article, "Capital social cadastrado", company?.capital_social != null ? "R$ " + String(company.capital_social) : "");
    line(article, "Atividade principal", safe(company?.cnae_fiscal_descricao));
    const address = [
      company?.logradouro,company?.numero,company?.bairro,company?.municipio,company?.uf
    ].map(safe).filter(Boolean).join(", ");
    line(article, "Endereço cadastral", address);
    line(article, "Consulta realizada", payload.fetchedAt ? new Date(payload.fetchedAt).toLocaleString("pt-BR") : "");
    if (payload.stale) note(article, "Atenção: uma parte das informações foi obtida de cache anterior da aplicação.");
    note(article, "Endereço cadastral, capital social e participação societária NÃO são provas de titularidade de imóveis, veículos ou saldo patrimonial.");
    if (Array.isArray(company?.qsa) && company.qsa.length) {
      article.append(el("h4", "Quadro de sócios e administradores"));
      const list = el("ul");
      for (const person of company.qsa.slice(0, 100)) {
        const name = safe(person.nome_socio || person.nome || person.razao_social);
        const role = safe(person.qualificacao_socio || person.qualificacao);
        if (name) list.append(el("li", name + (role ? " — " + role : "")));
      }
      article.append(list);
      note(article, "O QSA mostra vínculos societários declarados, não bens pessoais dos participantes.");
    } else note(article, "A fonte consultada não apresentou quadro societário neste retorno.");
    if (!company) note(article, "A consulta cadastral principal não respondeu; apenas outra fonte pública retornou dados.");
    article.append(el("h4", "Situação das fontes"));
    line(article, "BrasilAPI", company ? "Dados recebidos" : "Sem resultado nesta tentativa");
    line(article, "CNPJ.ws pública / inscrições estaduais", alternatives ? "Dados recebidos" : "Sem resultado nesta tentativa");
    source(article, "Documentação da fonte BrasilAPI", "https://brasilapi.com.br/docs#tag/CNPJ");
    box.append(article);
  }
  get("investigation-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const status = get("investigation-status");
    const cnpj = String(new FormData(form).get("cnpj") || "").replace(/\D/g, "");
    const purpose = String(new FormData(form).get("purpose") || "").trim();
    get("investigation-result").replaceChildren();
    if (cnpj.length !== 14 || purpose.length < 8) {
      status.textContent = "Informe CNPJ válido (14 dígitos) e a finalidade da diligência.";
      return;
    }
    if (!accessToken || !settings || get("workspace").hidden) {
      status.textContent = "Entre com uma conta autorizada antes de consultar.";
      return;
    }
    button.disabled = true;
    status.textContent = "Consultando cadastro empresarial nas fontes públicas...";
    try {
      // Verifica autorização de novo antes de consultar.
      const allowed = await api("/legal_access?select=enabled&user_id=eq." + encodeURIComponent(currentUser));
      if (!Array.isArray(allowed) || !allowed.some((a) => a.enabled)) throw new Error("Conta sem autorização de escritório.");
      const response = await fetch("/api/cnpj?cnpj=" + encodeURIComponent(cnpj), { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 429 ? "Limite de consultas atingido; tente mais tarde." : "Não foi possível consultar esta fonte agora.");
      const payload = await response.json();
      showCompany(payload);
      status.textContent = "Consulta cadastral concluída. Nenhuma base patrimonial foi consultada nesta operação.";
    } catch (error) {
      status.textContent = error.message || "Falha na consulta.";
    } finally {
      button.disabled = false;
    }
  });
  get("datajud-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const status = get("datajud-status");
    const target = get("datajud-results");
    target.replaceChildren();
    const fields = new FormData(form);
    const number = String(fields.get("number") || "").replace(/\D/g,"");
    const tribunal = String(fields.get("tribunal") || "");
    if (!/^\d{20}$/.test(number)) {
      status.textContent = "Informe os 20 dígitos do número CNJ.";
      return;
    }
    if (!accessToken || !settings || get("workspace").hidden) {
      status.textContent = "Entre com uma conta autorizada.";
      return;
    }
    button.disabled = true;
    status.textContent = "Consultando metadados públicos do CNJ...";
    try {
      const allowed = await api("/legal_access?select=enabled&user_id=eq." + encodeURIComponent(currentUser));
      if (!Array.isArray(allowed) || !allowed.some((entry) => entry.enabled))
        throw new Error("Conta não autorizada.");
      const response = await fetch("/api/juridico/datajud?numero=" +
        encodeURIComponent(number) + "&tribunal=" + encodeURIComponent(tribunal), { cache:"no-store" });
      if (!response.ok) {
        if (response.status === 429) throw new Error("Limite temporário de consultas; tente depois.");
        throw new Error("A fonte CNJ está indisponível ou não respondeu. Resultado inconclusivo.");
      }
      const result = await response.json();
      status.textContent = result.records?.length
        ? result.records.length + " processo(s) público(s) encontrado(s) no tribunal selecionado."
        : "Nenhum processo localizado nessa consulta ao tribunal. Isso não comprova inexistência.";
      note(target, "Fonte: " + result.source + " · Consultado em " +
        new Date(result.searchedAt).toLocaleString("pt-BR") + " · Tribunal: " + result.tribunal);
      for (const record of result.records || []) {
        const card = el("article", null, "investigation-card");
        card.append(el("h3", "Processo " + record.numeroProcesso));
        line(card, "Tribunal", record.tribunal);
        line(card, "Grau", record.grau);
        line(card, "Classe", record.classe);
        line(card, "Órgão julgador", record.orgaoJulgador);
        line(card, "Data de ajuizamento", record.dataAjuizamento);
        if (record.assuntos?.length) line(card, "Assuntos", record.assuntos.join(", "));
        if (record.movimentos?.length) {
          card.append(el("h4", "Movimentações públicas retornadas"));
          const list = el("ul");
          for (const movement of record.movimentos) {
            list.append(el("li", [movement.dataHora, movement.nome].filter(Boolean).join(" · ")));
          }
          card.append(list);
        }
        target.append(card);
      }
      source(target, "Consultar documentação oficial DataJud", result.sourceUrl);
      note(target, result.coverage);
    } catch (error) {
      status.textContent = error.message || "A consulta ao CNJ falhou.";
    } finally {
      button.disabled = false;
    }
  });
  get("rural-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const status = get("rural-status");
    const target = get("rural-result");
    target.replaceChildren();
    if (!accessToken || !settings || get("workspace").hidden) {
      status.textContent = "Entre com uma conta autorizada antes de analisar.";
      return;
    }
    const fd = new FormData(form);
    const file = fd.get("file");
    const holder = String(fd.get("holder") || "").trim();
    const scope = String(fd.get("scope") || "").trim();
    if (!(file instanceof File) || !file.size || file.size > 8_000_000 || !scope || holder.length < 3) {
      status.textContent = "Informe um CSV oficial de até 8 MB, nome e área de abrangência.";
      return;
    }
    button.disabled = true;
    status.textContent = "Analisando somente no navegador...";
    try {
      const allowed = await api("/legal_access?select=enabled&user_id=eq." + encodeURIComponent(currentUser));
      if (!Array.isArray(allowed) || !allowed.some((a) => a.enabled)) throw new Error("Conta sem autorização de escritório.");
      const result = RuralCsv.search(await file.text(), holder);
      status.textContent = result.matches.length
        ? result.matches.length + " vínculo(s) cadastral(is) encontrado(s) no CSV fornecido."
        : "Nenhuma correspondência exata de nome encontrada neste arquivo.";
      note(target, "Fonte: CSV público SNCR fornecido pelo usuário. Abrangência declarada: " + scope + ". Linhas examinadas: " + result.searchedRows + ".");
      for (const row of result.matches.slice(0, 100)) {
        const card = el("article", null, "investigation-card");
        card.append(el("h3", row.name || "Imóvel rural sem denominação"));
        line(card, "Titular declarado", row.holder);
        line(card, "Código SNCR", row.code);
        line(card, "Município/UF", [row.city,row.state].filter(Boolean).join(" / "));
        line(card, "Área informada", row.area ? row.area + " ha" : "");
        line(card, "Condição da pessoa", row.relation);
        line(card, "Percentual de detenção", row.share);
        target.append(card);
      }
      if (result.matches.length > 100) note(target, "Foram exibidos os 100 primeiros registros; restrinja o arquivo para analisar o restante.");
      note(target, "Os dados são DECLARATÓRIOS e uma correspondência por nome não confirma identidade nem titularidade atual. Ausência de registros não comprova ausência de bens.");
    } catch (error) {
      status.textContent = error.message || "Não foi possível analisar o CSV.";
    } finally {
      form.elements.file.value = "";
      button.disabled = false;
    }
  });
})();