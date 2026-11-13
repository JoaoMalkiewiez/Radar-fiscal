"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
test("Codespaces lab disables automatic forwarding and lifecycle stack execution", () => {
  const c = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../.devcontainer/radar-juridico/devcontainer.json",
      ),
    ),
  );
  assert.deepEqual(c.forwardPorts, []);
  assert.equal(c.otherPortsAttributes.onAutoForward, "ignore");
  assert.equal(
    c.customizations.vscode.settings["remote.autoForwardPorts"],
    false,
  );
  for (const name of [
    "onCreateCommand",
    "postCreateCommand",
    "postStartCommand",
    "initializeCommand",
    "privileged",
  ])
    assert.equal(c[name], undefined);
});
for (const [name, dfBody, expected] of [
  [
    "disco insuficiente",
    'echo "fs 99999999 1 1024 1% /"',
    "DOCKER_DISK_BELOW_30_GIB_PLANNING_MARGIN",
  ],
  ["disco desconhecido", 'echo "fs invalid"', "DOCKER_DISK_UNKNOWN"],
  [
    "daemon remoto inacessível",
    "echo synthetic-private-detail >&2; exit 1",
    "PREFLIGHT_UNAVAILABLE_CHECK_DAEMON_STORAGE_ACCESS",
  ],
]) {
  test(
    "preflight bloqueia " + name + " sem pulls e sem vazar stderr (unitário)",
    (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-preflight-"));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      fs.writeFileSync(
        path.join(dir, "docker"),
        '#!/bin/sh\ncase "$1" in\nversion) echo 29;;\ninfo) echo \'{"DockerRootDir":"/synthetic","Driver":"overlay2"}\';;\n*) exit 99;;\nesac\n',
        { mode: 0o700 },
      );
      fs.writeFileSync(path.join(dir, "df"), "#!/bin/sh\n" + dfBody + "\n", {
        mode: 0o700,
      });
      const r = spawnSync(
        process.execPath,
        [path.join(__dirname, "../lab/codespaces-preflight.mjs")],
        { env: { ...process.env, PATH: dir }, encoding: "utf8" },
      );
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), expected);
      assert.ok(!r.stderr.includes("synthetic-private-detail"));
    },
  );
}
