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
for (const [name, collectorBody, expected] of [
  [
    "disco insuficiente",
    `echo '{"endpoint":"unix:///synthetic.sock","pid":42,"executable":"dockerd","clientMount":"same","daemonMount":"same","clientRoot":"same","daemonRoot":"same","freeBytes":1024}'`,
    "DOCKER_DISK_BELOW_30_GIB_PLANNING_MARGIN",
  ],
  [
    "disco desconhecido",
    `echo '{"endpoint":"unix:///synthetic.sock","pid":42,"executable":"dockerd","clientMount":"same","daemonMount":"same","clientRoot":"same","daemonRoot":"same"}'`,
    "DOCKER_DISK_UNKNOWN",
  ],
  [
    "daemon remoto inacessível",
    "echo synthetic-private-detail >&2; exit 1",
    "HOST_CAPACITY_UNVERIFIED",
  ],
]) {
  test(
    "preflight bloqueia " + name + " sem pulls e sem vazar stderr (unitário)",
    (t) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-preflight-"));
      t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
      fs.writeFileSync(
        path.join(dir, "docker"),
        '#!/bin/sh\ncase "$1" in\nversion) echo 29;;\ncontext) echo \'[{"Endpoints":{"docker":{"Host":"unix:///synthetic.sock"}}}]\';;\ninfo) echo \'{"DockerRootDir":"/synthetic","Driver":"overlay2"}\';;\n*) exit 99;;\nesac\n',
        { mode: 0o700 },
      );
      fs.writeFileSync(
        path.join(dir, "python3"),
        "#!/bin/sh\n" + collectorBody + "\n",
        {
          mode: 0o700,
        },
      );
      const r = spawnSync(
        process.execPath,
        [path.join(__dirname, "../lab/codespaces-preflight.mjs")],
        {
          env: {
            ...process.env,
            DOCKER_HOST: "",
            DOCKER_CONTEXT: "",
            PATH: dir,
          },
          encoding: "utf8",
        },
      );
      assert.equal(r.status, 1);
      assert.equal(r.stderr.trim(), expected);
      assert.ok(!r.stderr.includes("synthetic-private-detail"));
    },
  );
}

const capacity = () => import("../lab/host-capacity.mjs");
const proof = () => ({
  endpoint: "unix:///var/run/docker.sock",
  pid: 42,
  executable: "dockerd",
  clientMount: "mnt:[1]",
  daemonMount: "mnt:[1]",
  clientRoot: "1:2",
  daemonRoot: "1:2",
  freeBytes: 40 * 2 ** 30,
});
test("disco aceita filesystem comprovado no mesmo namespace e raiz", async () => {
  const c = await capacity();
  assert.equal(c.daemonFilesystem(proof()), 40 * 2 ** 30);
});
for (const [field, value] of [
  ["endpoint", "tcp://remote:2375"],
  ["executable", "proxy"],
  ["pid", 0],
  ["daemonMount", "mnt:[2]"],
  ["daemonRoot", "2:3"],
  ["freeBytes", NaN],
]) {
  test("disco bloqueia evidência inválida: " + field, async () => {
    const c = await capacity();
    assert.throws(() => c.daemonFilesystem({ ...proof(), [field]: value }));
  });
}
test("memória admite máquina8GB com overhead e6GB disponíveis", async () => {
  const c = await capacity();
  assert.deepEqual(
    c.memoryCapacity(8e9, 6.5e9, 8e9, [{ limit: 8e9, current: 1e9 }]),
    { capacity: 8e9, available: 6.5e9 },
  );
});
for (const [label, groups, total, available] of [
  ["contêiner4GB em host64GB", [{ limit: 4e9, current: 1e9 }], 64e9, 50e9],
  [
    "ancestral limitado",
    [
      { limit: 16e9, current: 1e9 },
      { limit: 8e9, current: 3e9 },
    ],
    64e9,
    50e9,
  ],
  ["limite desconhecido", [{ current: 0 }], 64e9, 50e9],
  ["consumo desconhecido", [{ limit: 8e9 }], 64e9, 50e9],
  ["sem cgroups", [], 64e9, 50e9],
  ["host com pouca memória livre", [{ limit: "max", current: 0 }], 8e9, 5e9],
]) {
  test("memória bloqueia " + label, async () => {
    const c = await capacity();
    assert.throws(() => c.memoryCapacity(total, available, total, groups));
  });
}
test("memória limitada do Docker também restringe capacidade", async () => {
  const c = await capacity();
  assert.throws(() =>
    c.memoryCapacity(64e9, 50e9, 4e9, [{ limit: "max", current: 0 }]),
  );
});
test("memória unlimited usa host e aceita exatamente a margem6GB", async () => {
  const c = await capacity();
  assert.equal(
    c.memoryCapacity(8e9, 6e9, 8e9, [{ limit: "max", current: 0 }]).available,
    6e9,
  );
});
test("Codespaces mínimos obrigatórios e documentação de consumo coerentes", () => {
  const c = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "../../.devcontainer/radar-juridico/devcontainer.json",
      ),
    ),
  );
  assert.deepEqual(c.hostRequirements, {
    cpus: 4,
    memory: "8gb",
    storage: "64gb",
  });
  const readme = fs.readFileSync(
    path.join(__dirname, "../lab/README.md"),
    "utf8",
  );
  for (const word of [
    "mínimos obrigatórios",
    "4 core-hours",
    "2 CPUs",
    "GB-month",
  ])
    assert.ok(readme.includes(word), word);
});

for (const [label, code] of [
  ["endpoint remoto", 'm.collect("tcp://remote:2375", "/synthetic")'],
  [
    "cgroupv1 desconhecido",
    'mock.patch.object(m.Path, "read_text", return_value="2:memory:/x").start(); m.memory_groups("self")',
  ],
  [
    "ancestral oculto",
    'mock.patch.object(m.Path, "read_text", side_effect=["0::/x", "1 0 0:1 /hidden /sys/fs/cgroup rw - cgroup2 cgroup rw"]).start(); m.memory_groups("self")',
  ],
  [
    "consumo ilegível",
    'mock.patch.object(m.Path, "read_text", side_effect=["0::/x", "1 0 0:1 / /sys/fs/cgroup rw - cgroup2 cgroup rw", "8000000000", PermissionError()]).start(); m.memory_groups("self")',
  ],
]) {
  test("coletor Linux recusa " + label + " (unitário)", () => {
    const helper = path.join(__dirname, "../lab/collect-host-capacity.py");
    const r = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import importlib.util\nfrom unittest import mock\ns=importlib.util.spec_from_file_location("capacity", ${JSON.stringify(helper)})\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\ntry:\n ${code}\nexcept (ValueError, PermissionError):\n pass\nelse:\n raise AssertionError("unverified observation accepted")\n`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
  });
}

for (const [label, code] of [
  [
    "namespace cgroup oculto mesmo id entre processos",
    'mock.patch.object(m.os, "readlink", return_value="cgroup:[99]").start(); m.verify_cgroup_namespace(42)',
  ],
  [
    "namespace de montagem diferente",
    'fake=mock.MagicMock(); fake.__enter__.return_value.getsockopt.return_value=m.struct.pack("3i",42,0,0); mock.patch.object(m.socket,"socket",return_value=fake).start(); mock.patch.object(m.os,"readlink",side_effect=["/usr/bin/dockerd","mnt:[1]","mnt:[2]"]).start(); mock.patch.object(m,"identity",return_value="1:2").start(); m.collect("unix:///synthetic.sock","/same/path")',
  ],
  [
    "diretório homônimo de outro filesystem",
    'fake=mock.MagicMock(); fake.__enter__.return_value.getsockopt.return_value=m.struct.pack("3i",42,0,0); mock.patch.object(m.socket,"socket",return_value=fake).start(); mock.patch.object(m.os,"readlink",side_effect=["/usr/bin/dockerd","mnt:[1]","mnt:[1]"]).start(); mock.patch.object(m,"identity",side_effect=["1:2","1:2","3:4","5:6"]).start(); m.collect("unix:///synthetic.sock","/same/path")',
  ],
]) {
  test("coletor comprova limite de namespace: " + label + " (unitário)", () => {
    const helper = path.join(__dirname, "../lab/collect-host-capacity.py");
    const r = spawnSync(
      "python3",
      [
        "-B",
        "-c",
        `import importlib.util\nfrom unittest import mock\ns=importlib.util.spec_from_file_location("capacity", ${JSON.stringify(helper)})\nm=importlib.util.module_from_spec(s)\ns.loader.exec_module(m)\ntry:\n ${code}\nexcept ValueError:\n pass\nelse:\n raise AssertionError("unverified namespace accepted")\n`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 0, r.stderr);
  });
}
