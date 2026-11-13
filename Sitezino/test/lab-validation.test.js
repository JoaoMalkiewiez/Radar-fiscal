"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const safety = () => import("../lab/safety.mjs");
const key = (role) =>
  "e30." +
  Buffer.from(JSON.stringify({ role })).toString("base64url") +
  ".synthetic";
const configuration = () => ({
  url: "http://127.0.0.1:54001",
  mailpit: "http://127.0.0.1:54002",
  publicKey: "sb_publishable_synthetic",
  adminKey: key("service_role"),
  databaseContainer: "supabase_db_radar_unit",
});
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-lab-unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
for (const url of [
  "https://127.0.0.1:1",
  "http://localhost:1",
  "http://u:secret@127.0.0.1:1",
  "http://127.0.0.1:1/path",
  "http://127.0.0.1:1/?key=value",
  "http://127.0.0.1:1/#fragment",
  "http://remote.invalid",
])
  test(
    "origem local recusa componente inseguro: " + url.split("@").at(-1),
    async () => {
      const s = await safety();
      assert.throws(() => s.localBase(url));
    },
  );
test("configuração aceita separação de chaves e rejeita admin no campo público", async () => {
  const s = await safety();
  s.validateConfig(configuration());
  for (const publicKey of [
    key("service_role"),
    "sb_secret_synthetic",
    "unknown",
  ])
    assert.throws(
      () => s.validateConfig({ ...configuration(), publicKey }),
      /LAB_KEY_SEPARATION/,
    );
  assert.throws(
    () =>
      s.validateConfig({ ...configuration(), url: "http://127.0.0.1:5517" }),
    /COLLISION/,
  );
});
test("JSON privado inválido não vaza conteúdo no erro", async (t) => {
  const s = await safety(),
    dir = temporary(t),
    file = path.join(dir, "secret.json");
  fs.writeFileSync(file, "PRIVATE_SECRET_MARKER invalid");
  assert.throws(
    () => s.privateJSON(file),
    (e) =>
      !e.stack.includes("PRIVATE_SECRET_MARKER") &&
      /Invalid private/.test(e.message),
  );
});
test("arquivos privados não podem colidir, entrar no Git ou atravessar symlink", async (t) => {
  const s = await safety(),
    dir = temporary(t),
    file = path.join(dir, "private.json");
  s.privateLocations([file, path.join(dir, "evidence.json")]);
  assert.throws(() => s.privateLocations([file, file]), /COLLISION/);
  assert.throws(
    () => s.privateLocations([path.join(__dirname, "inside-repo.json")]),
    /REPOSITORY/,
  );
  fs.writeFileSync(file, "{}");
  const link = path.join(dir, "link.json");
  fs.symlinkSync(file, link);
  assert.throws(() => s.privateLocations([link]), /SYMLINK/);
});
test("escrita privada mantém modo 0600 e não sobrescreve criação exclusiva", async (t) => {
  const s = await safety(),
    file = path.join(temporary(t), "state.json");
  s.writePrivate(file, { synthetic: true }, true);
  fs.chmodSync(file, 0o644);
  s.writePrivate(file, { updated: true });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.throws(() => s.writePrivate(file, {}, true));
});
for (const response of [
  { status: 400, data: { code: "23502" } },
  { status: 401, data: { code: "PGRST301" } },
  { status: 500, data: { code: "42501" } },
  { status: 400, data: null },
])
  test(
    "erro alheio não comprova RLS: " +
      response.data?.code +
      "/" +
      response.status,
    async () => {
      const s = await safety();
      assert.throws(() => s.databaseDenied(response));
    },
  );
test("negação do banco exige SQLSTATE pertinente", async () => {
  const s = await safety();
  s.databaseDenied({ status: 403, data: { code: "42501" } });
  s.databaseDenied({ status: 409, data: { code: "23503" } }, [
    "42501",
    "23503",
  ]);
  assert.throws(() =>
    s.databaseDenied({ status: 409, data: { code: "23505" } }, ["23503"]),
  );
});
for (const kind of ["access", "size", "mime"])
  test("Storage não aceita 4xx/5xx genérico como prova: " + kind, async () => {
    const s = await safety();
    for (const status of [400, 401, 500])
      assert.throws(() =>
        s.storageDenied({ status, data: { error: "unknown" } }, kind),
      );
  });
test("Storage reconhece formatos de erro explícitos modernos e legados", async () => {
  const s = await safety();
  s.storageDenied({ status: 400, data: { statusCode: "404" } });
  s.storageDenied({ status: 413, data: {} }, "size");
  s.storageDenied({ status: 400, data: { code: "InvalidMimeType" } }, "mime");
});
test("integridade detecta alteração de conteúdo mesmo com owner/id intactos", async () => {
  const s = await safety();
  const before = {
    id: "synthetic",
    owner_id: "A",
    name: "Original",
    notes: null,
  };
  s.unchanged({ ...before }, before);
  assert.throws(
    () => s.unchanged({ ...before, name: "Modified" }, before),
    /FIXTURE_CONTENT_CHANGED/,
  );
});
for (const mode of ["typo", "cleanup"])
  test("runner recusa " + mode + " antes de criar manifesto ou rede", (t) => {
    const dir = temporary(t),
      file = path.join(dir, "config.json"),
      state = path.join(dir, "state.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        ...configuration(),
        stateFile: state,
        evidenceFile: path.join(dir, "result.json"),
      }),
      { mode: 0o600 },
    );
    const r = spawnSync(
      process.execPath,
      [path.join(__dirname, "../lab/validate-real.mjs"), mode],
      {
        env: { ...process.env, RADAR_LAB_CONFIG: file },
        encoding: "utf8",
        timeout: 5000,
      },
    );
    assert.notEqual(r.status, 0);
    assert.match(
      r.stderr,
      mode === "typo" ? /Explicit mode/ : /Existing laboratory manifest/,
    );
    assert.equal(fs.existsSync(state), false);
  });
function manifest() {
  const run = randomUUID(),
    id = randomUUID();
  return {
    run,
    users: { A: { id, email: `radar-${run}-a@example.test` } },
    records: {},
    results: [],
    extraPaths: [`${id}/e2e-${run}.pdf`],
  };
}
for (const failure of [
  "storage-denied",
  "object-remains",
  "wrong-user",
  "user-delete-denied",
  "user-remains",
])
  test("limpeza não declara sucesso em " + failure, async () => {
    const { cleanupManifest } = await import("../lab/cleanup.mjs");
    const state = manifest();
    let userDeleted = false;
    const admin = async (p, opts = {}) => {
      if (p.startsWith("/storage/"))
        return { status: failure === "storage-denied" ? 403 : 200 };
      if (opts.method === "DELETE") {
        userDeleted = true;
        return { status: failure === "user-delete-denied" ? 403 : 200 };
      }
      if (userDeleted && failure !== "user-remains")
        return { status: 404, data: { code: "user_not_found" } };
      return {
        status: 200,
        data: {
          id: state.users.A.id,
          email:
            failure === "wrong-user"
              ? "not-our-fixture@example.test"
              : state.users.A.email,
        },
      };
    };
    await assert.rejects(
      cleanupManifest(state, {
        admin,
        sql: () => (failure === "object-remains" ? "1" : "0"),
        save() {},
      }),
    );
    assert.equal(state.cleaned, false);
    if (["storage-denied", "object-remains", "wrong-user"].includes(failure))
      assert.equal(userDeleted, false);
  });
test("limpeza exige confirmação e ausência de objetos/usuários", async () => {
  const { cleanupManifest } = await import("../lab/cleanup.mjs");
  const state = manifest();
  let removed = false;
  await cleanupManifest(state, {
    admin: async (p, opts = {}) => {
      if (p.startsWith("/storage/")) return { status: 200 };
      if (opts.method === "DELETE") {
        removed = true;
        return { status: 200 };
      }
      return removed
        ? { status: 404, data: { code: "user_not_found" } }
        : {
            status: 200,
            data: { id: state.users.A.id, email: state.users.A.email },
          };
    },
    sql: () => "0",
    save() {},
  });
  assert.equal(state.cleaned, true);
});
test("manifesto rejeita usuário/caminho estranho antes de exclusões", async () => {
  const s = await safety();
  const state = manifest();
  s.validManifest(state);
  state.extraPaths.push(randomUUID() + "/unrelated.pdf");
  assert.throws(() => s.validManifest(state), /INVALID_OBJECT_MANIFEST/);
});
test("compatibilidade GoTrue aceita error_code REST sem confundir HTTP code numérico", async () => {
  const s = await safety();
  assert.equal(
    s.authErrorCode({ data: { code: 404, error_code: "user_not_found" } }),
    "user_not_found",
  );
  assert.equal(
    s.authErrorCode({ data: { code: "user_not_found" } }),
    "user_not_found",
  );
  assert.equal(s.authErrorCode({ data: { code: 404 } }), null);
});
test("manifesto incompleto é recusado antes de qualquer limpeza", async () => {
  const s = await safety(),
    state = manifest();
  state.records.A = { ids: {}, bodies: {}, path: state.extraPaths[0] };
  assert.throws(() => s.validManifest(state), /INVALID_RECORD_MANIFEST/);
});
test("cleanup confirmado encerra com sucesso sem apagar histórico reprovado da suíte", async (t) => {
  const http = require("node:http"),
    { spawn } = require("node:child_process");
  const dir = temporary(t),
    state = manifest();
  state.extraPaths = [];
  state.results = [{ id: "old.failed.test", status: "REPROVADO" }];
  let removed = false;
  const server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.method === "DELETE") {
      removed = true;
      res.end("{}");
    } else if (removed) {
      res.statusCode = 404;
      res.end(JSON.stringify({ code: 404, error_code: "user_not_found" }));
    } else res.end(JSON.stringify(state.users.A));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const stateFile = path.join(dir, "state.json"),
    evidenceFile = path.join(dir, "evidence.json"),
    configFile = path.join(dir, "config.json");
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      ...configuration(),
      url: `http://127.0.0.1:${server.address().port}`,
      mailpit: "http://127.0.0.1:1",
      stateFile,
      evidenceFile,
    }),
    { mode: 0o600 },
  );
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "../lab/validate-real.mjs"), "cleanup"],
    {
      env: { ...process.env, RADAR_LAB_CONFIG: configFile },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  t.after(() => child.kill());
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(Error("unit child timeout"));
    }, 5000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  assert.equal(code, 0);
  const evidence = JSON.parse(fs.readFileSync(evidenceFile));
  assert.equal(evidence.cleaned, true);
  assert.equal(evidence.counts.REPROVADO, 1);
  assert.equal(evidence.phase_counts.REPROVADO, 0);
  assert.equal(evidence.phase_counts.APROVADO, 1);
});
test("criação de conta sem resposta exige reconciliação antes de declarar limpeza", async () => {
  const { cleanupManifest } = await import("../lab/cleanup.mjs");
  const state = manifest();
  state.cleaned = true;
  state.pendingUsers = { B: { email: `radar-${state.run}-b@example.test` } };
  let calls = 0;
  await assert.rejects(
    cleanupManifest(state, {
      admin: async () => {
        calls++;
        return { status: 200 };
      },
      sql: () => {
        calls++;
        return "0";
      },
      save() {},
    }),
    /CLEANUP_PENDING_USERS/,
  );
  assert.equal(calls, 0);
  assert.equal(state.cleaned, false);
});
for (const kind of ["publishable", "legacy-anon"])
  test(
    "conversor CLI preserva chave pública " +
      kind +
      " fora do Git sem imprimir segredos",
    (t) => {
      const dir = temporary(t),
        input = path.join(dir, "status.json"),
        output = path.join(dir, "config.json");
      const publicKey =
        kind === "publishable" ? "sb_publishable_synthetic" : key("anon");
      fs.writeFileSync(
        input,
        JSON.stringify({
          API_URL: configuration().url,
          MAILPIT_URL: configuration().mailpit,
          [kind === "publishable" ? "PUBLISHABLE_KEY" : "ANON_KEY"]: publicKey,
          SERVICE_ROLE_KEY: configuration().adminKey,
        }),
        { mode: 0o600 },
      );
      const r = spawnSync(
        process.execPath,
        [
          path.join(__dirname, "../lab/configure-private.mjs"),
          input,
          "supabase_db_radar_unit",
          output,
        ],
        { encoding: "utf8", timeout: 5000 },
      );
      assert.equal(r.status, 0);
      const config = JSON.parse(fs.readFileSync(output));
      assert.equal(config.publicKey, publicKey);
      assert.equal(config.adminKey, configuration().adminKey);
      assert.equal(fs.statSync(output).mode & 0o777, 0o600);
      assert.ok(
        !r.stdout.includes(config.adminKey) &&
          !r.stderr.includes(config.adminKey),
      );
    },
  );
for (const flaw of ["admin-as-public", "output-in-Git"])
  test("conversor CLI recusa " + flaw + " sem gravar configuração", (t) => {
    const dir = temporary(t),
      input = path.join(dir, "status.json"),
      output =
        flaw === "output-in-Git"
          ? path.join(__dirname, "forbidden-" + randomUUID() + ".json")
          : path.join(dir, "config.json");
    fs.writeFileSync(
      input,
      JSON.stringify({
        API_URL: configuration().url,
        MAILPIT_URL: configuration().mailpit,
        PUBLISHABLE_KEY:
          flaw === "admin-as-public"
            ? configuration().adminKey
            : "sb_publishable_synthetic",
        SERVICE_ROLE_KEY: configuration().adminKey,
      }),
    );
    const r = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "../lab/configure-private.mjs"),
        input,
        "supabase_db_radar_unit",
        output,
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(output), false);
    assert.ok(!r.stderr.includes(configuration().adminKey));
  });

for (const type of ["invite", "recovery"]) {
  for (const redirect of [
    "",
    "&redirect_to=" +
      encodeURIComponent("http://127.0.0.1:5517/juridico/portal"),
  ]) {
    test(`link local ${type} aceita token e retorno ${Boolean(redirect)}`, async () => {
      const s = await safety();
      const link = `http://127.0.0.1:54001/auth/v1/verify?token=synthetic-token&type=${type}${redirect}`;
      assert.equal(s.localAuthLink(link, configuration().url, type).href, link);
      assert.throws(() => s.localBase(link));
    });
  }
}
const actionLink =
  "http://127.0.0.1:54001/auth/v1/verify?token=synthetic-token&type=invite";
const badLinks = [
  ["externo", actionLink.replace("127.0.0.1", "external.invalid")],
  ["https", actionLink.replace("http:", "https:")],
  ["porta", actionLink.replace("54001", "54003")],
  ["localhost", actionLink.replace("127.0.0.1", "localhost")],
  ["credenciais", actionLink.replace("127.0.0.1", "u:synthetic@127.0.0.1")],
  ["caminho", actionLink.replace("/auth/v1/verify", "/other/verify")],
  ["fragmento", actionLink + "#secret"],
  ["tipo divergente", actionLink.replace("invite", "recovery")],
  ["tipo proibido", actionLink.replace("invite", "signup")],
  ["token ausente", actionLink.replace("token=synthetic-token&", "")],
  ["token vazio", actionLink.replace("synthetic-token", "")],
  ["tipo duplicado", actionLink + "&type=recovery"],
  ["token duplicado", actionLink + "&token=second"],
  ["parametro inesperado", actionLink + "&next=external"],
  ...[
    "http://external.invalid",
    "/juridico/portal",
    "http://127.0.0.1:5517/other",
    "http://127.0.0.1:5517/juridico/portal?next=x",
  ].map((url, i) => [
    "retorno " + i,
    actionLink + "&redirect_to=" + encodeURIComponent(url),
  ]),
  ["retorno duplicado", actionLink + "&redirect_to=&redirect_to="],
  ["url malformada", "http://[invalid/synthetic-token"],
];
for (const [label, link] of badLinks) {
  test("link Auth rejeita " + label + " sem expor segredo", async () => {
    const s = await safety();
    assert.throws(() => s.localAuthLink(link, configuration().url, "invite"), {
      message: "INVALID_LOCAL_AUTH_LINK",
    });
  });
}
test("link Auth recusa tipo solicitado proibido e base inválida", async () => {
  const s = await safety();
  assert.throws(() =>
    s.localAuthLink(actionLink, configuration().url, "signup"),
  );
  assert.throws(
    () => s.localAuthLink(actionLink, "http://external.invalid", "invite"),
    { message: "INVALID_LOCAL_AUTH_LINK" },
  );
});
