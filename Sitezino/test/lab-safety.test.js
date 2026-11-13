"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
for (const filename of ["validate-real.mjs", "portal-harness.mjs"]) {
  test(
    "laboratório recusa backend hospedado antes de acessar rede: " + filename,
    (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-lab-guard-"));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      const config = path.join(dir, "private.json");
      fs.writeFileSync(
        config,
        JSON.stringify({
          url: "https://project.example.invalid",
          mailpit: "http://127.0.0.1:54324",
        }),
        { mode: 0o600 },
      );
      const r = spawnSync(
        process.execPath,
        [path.join(__dirname, "..", "lab", filename)],
        {
          env: { ...process.env, RADAR_LAB_CONFIG: config },
          encoding: "utf8",
          timeout: 10000,
        },
      );
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /loopback/);
    },
  );
}
