"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServer, parseMonitorStates, resetRateLimits } = require("../server");

async function withServer(callback) {
  resetRateLimits();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    await callback(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("normaliza IDs estaduais da TecnoSpeed sem perder SP por diferença de caixa/campo", () => {
  const result = parseMonitorStates([
    { id_worker: "SEFAZ_NFE_ENVIO_SP", status: "1" },
    { worker_id: "sefaz_nfe_envio_rj", status: "2" },
    { workerId: "sefaz_nfce_envio_sp", status: "3" },
    { id: "sefaz_nfe_envio_sc", status: "5" },
    { id_worker: "sefaz_nfe_envio_svrs", status: "1" },
  ], "nfe");

  assert.deepEqual(result, { SP: 1, RJ: 2, SC: 5 });
});

test("aceita a UF em campo próprio quando o worker não vem no identificador", () => {
  const result = parseMonitorStates([
    { uf: "sp", doc: "nfe", status: 1 },
    { uf: "XX", doc: "nfe", status: 1 },
    { uf: "RJ", doc: "nfce", status: 2 },
  ], "nfe");

  assert.deepEqual(result, { SP: 1 });
});

test("serve a página inicial com segurança e gzip", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/`, {
      headers: { "Accept-Encoding": "gzip" },
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(response.headers.get("content-security-policy") || "", /default-src 'self'/);
    assert.equal(response.headers.get("content-encoding"), "gzip");

    const body = await response.text();
    assert.match(body, /Radar Fiscal/);
    assert.match(body, /monitor-search/);
  });
});

test("prévia de gestão jurídica não permite cadastro e não substitui a área existente", async () => {
  await withServer(async (base) => {
    const [preview, original, api] = await Promise.all([
      fetch(base + "/juridico/gestao"),
      fetch(base + "/juridico"),
      fetch(base + "/api/juridico/clientes"),
    ]);
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /prévia visual com exemplos fictícios/i);
    assert.equal(original.status, 200);
    assert.match(await original.text(), /Consultar número processual/);
    assert.equal(api.status, 404);
  });
});

test("área privada não expõe credenciais nem permite gravação sem configuração", async () => {
  await withServer(async (base) => {
    const [page, script, config, write] = await Promise.all([
      fetch(base + "/juridico/portal"),
      fetch(base + "/juridico-portal.js"),
      fetch(base + "/api/juridico/config"),
      fetch(base + "/api/juridico/clientes", { method: "POST" }),
    ]);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Entrar no Radar Jurídico/);
    assert.equal(script.status, 200);
    assert.match(await script.text(), /legal_clients/);
    assert.equal(config.status, 503);
    assert.equal(write.status, 405);
    assert.equal((await config.json()).error, "Área privada ainda não configurada.");
  });
});

test("revalida assets estáticos com ETag sem reenviar o arquivo", async () => {
  await withServer(async (base) => {
    const first = await fetch(base + "/styles.css");
    assert.equal(first.status, 200);
    const etag = first.headers.get("etag");
    assert.ok(etag);
    assert.equal(first.headers.get("cache-control"), "no-cache");
    assert.equal(first.headers.get("vary"), "Accept-Encoding");
    const lastModified = first.headers.get("last-modified");
    assert.ok(lastModified);
    await first.arrayBuffer();

    const revalidated = await fetch(base + "/styles.css", {
      headers: { "If-None-Match": etag },
    });
    assert.equal(revalidated.status, 304);
    assert.equal(revalidated.headers.get("etag"), etag);
    assert.equal(await revalidated.text(), "");

    const byDate = await fetch(base + "/styles.css", {
      headers: { "If-Modified-Since": lastModified },
    });
    assert.equal(byDate.status, 304);
  });
});

test("descarta CNPJ matematicamente inválido antes de acessar fornecedores", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/cnpj?cnpj=11111111111111");
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /dígitos verificadores inválidos/);
  });
});

test("expõe health check sem consultar fontes externas", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.equal(body.status, "ok");
    assert.equal(typeof body.uptime, "number");
  });
});

test("valida o CNPJ antes de chamar as fontes", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/api/cnpj?cnpj=123`);
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /14/);
  });
});

test("publica robots.txt e sitemap.xml", async () => {
  await withServer(async (base) => {
    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.status, 200);
    const robotsBody = await robots.text();
    assert.match(robotsBody, /User-agent: \*/);
    assert.match(robotsBody, /Allow: \//);
    assert.match(robotsBody, /Sitemap: https:\/\/radar-fiscal-iyn3\.onrender\.com\/sitemap\.xml/);

    const sitemap = await fetch(`${base}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get("content-type") || "", /application\/xml/);
    const sitemapBody = await sitemap.text();
    assert.match(sitemapBody, /<urlset/);
    assert.match(sitemapBody, /<loc>http:\/\/127\.0\.0\.1:\d+\/<\/loc>/);
  });
});

test("gera URL HTTPS canônica no sitemap do domínio Render", async () => {
  await withServer(async (base) => {
    // http.request permite controlar Host explicitamente no teste; fetch pode substituí-lo.
    const body = await new Promise((resolve, reject) => {
      const target = new URL(base + "/sitemap.xml");
      const request = http.request({
        hostname: target.hostname, port: target.port, path: target.pathname,
        headers: { Host: "radar-fiscal-iyn3.onrender.com" },
      }, (response) => {
        assert.equal(response.statusCode, 200);
        let content = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => { content += chunk; });
        response.on("end", () => resolve(content));
      });
      request.on("error", reject);
      request.end();
    });
    assert.match(body, /<loc>https:\/\/radar-fiscal-iyn3\.onrender\.com\/<\/loc>/);
  });
});

test("portal jurídico oferece pesquisa e manutenção de registros sem expor dados", async () => {
  await withServer(async (base) => {
    const [page, script] = await Promise.all([
      fetch(base + "/juridico/portal"), fetch(base + "/juridico-portal.js"),
    ]);
    assert.equal(page.status, 200);
    assert.equal(script.status, 200);
    const html = await page.text();
    const js = await script.text();
    for (const id of ["client-search","case-search","document-search","event-search","upcoming-list"])
      assert.ok(html.includes('id="' + id + '"'), id);
    for (const name of ["refreshAccessToken","showRecordEditor","updateRecord","removeRecord"])
      assert.ok(js.includes(name), name);
    assert.doesNotMatch(js, /localStorage\.setItem|sessionStorage\.setItem|Notification\.requestPermission/);
    assert.doesNotMatch(html, /googleads|adsbygoogle|googlesyndication/);
    assert.equal((await fetch(base + "/api/juridico/clientes")).status, 404);
  });
});

test("serve a página de CPF e seus arquivos sem consultar dados pessoais", async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/cpf`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Consulta de CPF/);
    assert.match(html, /sem enviar o número a nenhum servidor/);
    assert.match(html, /ConsultaSituacao\/ConsultaPublica\.asp/);
    for (const asset of ["/cpf.js", "/cpf.css"]) {
      const response = await fetch(`${base}${asset}`);
      assert.equal(response.status, 200);
    }
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /<loc>http:\/\/127\.0\.0\.1:\d+\/cpf<\/loc>/);
  });
});

test("consulta contratada de CPF permanece bloqueada sem chaves do Serpro", async () => {
  await withServer(async (base) => {
    const status = await fetch(base + "/api/cpf/status");
    assert.equal(status.status, 200);
    const info = await status.json();
    assert.equal(typeof info.serproDisponivel, "boolean");
    if (!info.serproDisponivel) {
      const response = await fetch(base + "/api/cpf/consulta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: "52998224725", nascimento: "1996-11-05", finalidade: "Consulta autorizada", confirmacao: true }),
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const payload = await response.json();
      assert.match(payload.error, /não contratada|não habilitada/);
    }
  });
});

test("consulta de CPF expõe formulário de operador sem chaves no HTML", async () => {
  await withServer(async (base) => {
    const page = await fetch(base + "/cpf");
    const html = await page.text();
    assert.match(html, /id="cpf-serpro-section"[^>]*hidden/);
    assert.match(html, /id="cpf-api-form"/);
    assert.match(html, /id="cpf-api-key"/);
    assert.match(html, /Consulta CPF v3/);
    const script = await (await fetch(base + "/cpf.js")).text();
    assert.match(script, /\/api\/cpf\/status/);
    assert.match(script, /\/api\/cpf\/consulta/);
  });
});

test("serve Radar Jurídico e mantém as três ferramentas isoladas", async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/juridico`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /Radar Jurídico/);
    assert.match(html, /Processos judiciais/);
    assert.match(html, /Investigação empresarial/);
    assert.match(html, /Análise documental/);
    assert.match(html, /id="tribunal-link"/);
    assert.match(html, /id="copy-process"/);
    for (const asset of ["/juridico.js", "/juridico.css"]) {
      const response = await fetch(`${base}${asset}`);
      assert.equal(response.status, 200);
    }
    const sitemap = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.match(sitemap, /\/juridico<\/loc>/);
  });
});

test("serve Pesquisa Patrimonial, arquivos e referências oficiais sem API pessoal", async () => {
  await withServer(async (base) => {
    for (const route of ["/patrimonio", "/patrimonio/"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Pesquisa Patrimonial/);
      assert.match(html, /ridigital\.org\.br/);
      assert.match(html, /gov\.br\/pt-br\/servicos\/consultar-online-dados-de-seus-veiculos/);
      assert.match(html, /id="tab-imoveis"/);
      assert.match(html, /id="tab-veiculos"/);
      assert.match(html, /Pesquisa Nacional de Bens/);
      assert.match(html, /Pesquisa Qualificada/);
      assert.doesNotMatch(html, /id="asset-form"/);
      assert.doesNotMatch(html, /id="asset-consent"/);
      assert.doesNotMatch(html, /id="asset-document"/);
    }
    for (const asset of ["/patrimonio.js", "/patrimonio.css"]) {
      const response = await fetch(base + asset);
      assert.equal(response.status, 200);
    }
    const script = await (await fetch(base + "/patrimonio.js")).text();
    assert.doesNotMatch(script, /fetch\(/);
    assert.doesNotMatch(script, /asset-document|asset-form|asset-consent/);
    assert.match(script, /activateTab/);
    const sitemap = await (await fetch(base + "/sitemap.xml")).text();
    assert.match(sitemap, /\/patrimonio<\/loc>/);
  });
});

test("publica o relatório de CNPJ com opção de impressão em PDF", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/app.js");
    const source = await response.text();
    assert.match(source, /data-action="print"/);
    assert.match(source, /Relatório informativo de CNPJ/);
    assert.match(source, /window\.print\(\)/);
  });
});

test("não expõe arquivos do servidor", async () => {
  await withServer(async (base) => {
    const response = await fetch(`${base}/server.js`);
    assert.equal(response.status, 404);
  });
});

test("aplica limite por IP nas consultas de CNPJ", async () => {
  await withServer(async (base) => {
    let lastStatus = 0;
    for (let index = 0; index < 31; index += 1) {
      const response = await fetch(`${base}/api/cnpj?cnpj=123`);
      lastStatus = response.status;
      if (index < 30) assert.equal(response.status, 400);
    }
    assert.equal(lastStatus, 429);
  });
});

test("fluxo jurídico privado exige autorização adicional e oferece histórico de processos", async () => {
  await withServer(async (base) => {
    const html = await (await fetch(base + "/juridico/portal")).text();
    const js = await (await fetch(base + "/juridico-portal.js")).text();
    for (const id of ["movement-form", "movement-case", "movement-search", "movement-list"])
      assert.ok(html.includes('id="' + id + '"'), id);
    assert.match(js, /legal_access\?select=enabled,role/);
    assert.match(js, /legal_movements/);
    assert.match(js, /Esta conta ainda não foi autorizada/);
    assert.doesNotMatch(js, /window\.alert|window\.confirm|Notification\.requestPermission/);
  });
});

test("dashboard privado exibe auditoria sem dados pessoais ou notificações invasivas", async () => {
  await withServer(async (base) => {
    const [page, script] = await Promise.all([
      fetch(base + "/juridico/portal"), fetch(base + "/juridico-portal.js"),
    ]);
    const html = await page.text();
    const js = await script.text();
    assert.match(html, /id="audit-list"/);
    assert.match(js, /legal_audit_logs/);
    assert.match(js, /entityNames/);
    assert.doesNotMatch(js, /Notification\.requestPermission|window\.alert\(|window\.confirm\(/);
  });
});
