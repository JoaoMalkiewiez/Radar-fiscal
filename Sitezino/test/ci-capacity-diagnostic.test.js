"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
for (const available of [true, false]) {
  test(
    "diagnóstico CI sanitiza ambiente e mantém bloqueio: daemon " + available,
    (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-ci-diag-"));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      fs.writeFileSync(
        path.join(dir, "docker"),
        available
          ? `#!/bin/sh
case "$1 $2" in
"info --format") echo '{"Driver":"synthetic","DockerRootDir":"/synthetic","MemTotal":8000000000,"private":"synthetic-secret"}';;
"system df") echo '{"Type":"Images","Size":"1MB","private":"synthetic-secret"}';;
*) echo synthetic-secret >&2; exit 99;;
esac
`
          : "#!/bin/sh\necho synthetic-secret >&2\nexit 1\n",
        { mode: 0o700 },
      );
      const python = spawnSync("which", ["python3"], {
        encoding: "utf8",
      }).stdout.trim();
      const r = spawnSync(
        python,
        ["-B", path.join(__dirname, "../lab/ci-capacity-diagnostic.py")],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: dir,
            DOCKER_CONTEXT: "",
            DOCKER_HOST: "tcp://user:synthetic-secret@external.invalid:2375",
          },
        },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!(r.stdout + r.stderr).includes("synthetic-secret"));
      const result = JSON.parse(r.stdout);
      assert.equal(result.purpose, "diagnostic-only-not-capacity-approval");
      assert.equal(result.daemonFilesystemBytes, undefined);
      if (available) {
        assert.equal(result.endpointKind, "unsupported-or-unknown");
        assert.equal(
          result.errors.daemonFilesystemBytes,
          "DOCKER_PEER_UNVERIFIED",
        );
        assert.equal(result.daemonDiskUsage[0].private, undefined);
      } else assert.equal(result.errors.docker, "CalledProcessError");
    },
  );
}
