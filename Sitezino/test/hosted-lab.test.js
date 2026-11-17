"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const moduleForLab = () => import("../lab/hosted/target.mjs");
const ref = "pkiowhcjmxfznhuhrxvj";
const approval = () => ({
  projectRef: ref,
  creationApproved: true,
  organizationId: "hwjjvpmhopftkwcbscnx",
  projectName: "radar-juridico-lab",
  plan: "free",
  quotedMonthlyUSD: 0,
});
const config = () => ({ projectRef: ref, url: `https://${ref}.supabase.co` });
test("hosted lab bloqueia produção, projeto arbitrário e autorização pendente antes da rede", async () => {
  const m = await moduleForLab();
  const prod = {
    projectRef: m.PRODUCTION_REF,
    url: `https://${m.PRODUCTION_REF}.supabase.co`,
  };
  assert.throws(() =>
    m.validateHostedTarget(prod, {
      ...approval(),
      projectRef: m.PRODUCTION_REF,
    }),
  );
  assert.throws(() =>
    m.validateHostedTarget(config(), {
      ...m.loadAuthorization(),
      creationApproved: false,
    }),
  );
  for (const url of [
    "https://external.invalid",
    `https://${m.PRODUCTION_REF}.supabase.co`,
    config().url + "/",
    config().url + "?token=synthetic",
  ])
    assert.throws(() =>
      m.validateHostedTarget({ ...config(), url }, approval()),
    );
  const other = "abcdefghijklmnopqrst";
  assert.throws(() =>
    m.validateHostedTarget(
      { projectRef: other, url: `https://${other}.supabase.co` },
      { ...approval(), projectRef: other },
    ),
  );
  assert.equal(
    m.validateHostedTarget(config(), approval()).origin,
    config().url,
  );
});
test("hosted lab não segue redirects, não vaza URL e preserva alvo após mutação", async () => {
  const m = await moduleForLab();
  let calls = 0;
  const c = config(),
    a = approval();
  const request = m.hostedRequest(c, a, async (url, opts) => {
    calls++;
    assert.equal(url.origin, config().url);
    assert.equal(opts.redirect, "manual");
    return { status: 302 };
  });
  c.url = `https://${m.PRODUCTION_REF}.supabase.co`;
  a.projectRef = m.PRODUCTION_REF;
  await assert.rejects(request("/auth/v1/token"), {
    message: "HOSTED_LAB_REQUEST_FAILED",
  });
  for (const target of [
    "https://external.invalid",
    "//external.invalid/auth/v1/token",
    "/rest/v1/../../../evil",
    "/auth/v1/token#secret",
    "/auth\\v1/token",
  ])
    await assert.rejects(request(target), {
      message: "HOSTED_LAB_TARGET_DENIED",
    });
  assert.equal(calls, 1);
});
