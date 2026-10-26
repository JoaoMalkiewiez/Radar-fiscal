"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
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
    assert.match(robotsBody, /User-agent: \\*/);
    assert.match(robotsBody, /Allow: \/\\//);
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
    const response = await fetch(`${base}/sitemap.xml`, {
      headers: { host: "radar-fiscal-iyn3.onrender.com" },
    });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /<loc>https:\/\/radar-fiscal-iyn3\.onrender\.com\/<\/loc>/);
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
