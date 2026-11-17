// Explicit real-browser public-flow check; never runs in npm test.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
let phase = "launch";
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.RADAR_CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
  });
  const results = [];
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", () => errors.push("PAGE_ERROR"));
      phase = "goto";
      await page.goto("http://127.0.0.1:5517/juridico/portal");
      phase = "login-visible";
      await page.locator("#login-panel").waitFor({ state: "visible" });
      await page
        .locator("#login-form [name=email]")
        .fill(`radar-${crypto.randomBytes(4).toString("hex")}@example.test`);
      await page
        .locator("#login-form [name=password]")
        .fill(crypto.randomBytes(20).toString("hex"));
      const statuses = [];
      page.on("response", (r) => {
        if (new URL(r.url()).pathname === "/auth/v1/token")
          statuses.push(r.status());
      });
      await page.locator("#login-form button").click();
      phase = "feedback";
      await page.locator("#feedback").waitFor({ state: "visible" });
      assert.deepEqual(statuses, [400]);
      assert.equal(await page.locator("#workspace").isVisible(), false);
      phase = "recover-click";
      await page.locator("#open-recover").click();
      phase = "recover-visible";
      await page.locator("#recover-panel").waitFor({ state: "visible" });
      // Do not send email without a private SMTP test destination.
      phase = "storage";
      assert.equal(
        await page.evaluate(() => localStorage.length + sessionStorage.length),
        0,
      );
      phase = "page-errors";
      assert.deepEqual(errors, []);
      results.push({
        width,
        invalidLoginHTTP: 400,
        workspaceHidden: true,
        recoveryFormOnly: true,
        noBrowserErrors: true,
        status: "APROVADO",
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }
  const evidence = {
    scope: "REAL_UI_PUBLIC_FLOWS_ONLY_NO_AUTHENTICATED_E2E",
    results,
  };
  if (process.argv[2])
    fs.writeFileSync(process.argv[2], JSON.stringify(evidence, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  console.log(JSON.stringify(evidence));
})().catch((error) => {
  console.error("HOSTED_UI_PUBLIC_CHECK_FAILED:" + phase + ":" + error.name);
  process.exitCode = 1;
});
