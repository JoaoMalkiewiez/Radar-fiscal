// Explicit opt-in real local integration checks. Never run against a hosted project.
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
import {
  privateJSON,
  validateConfig,
  privateLocations,
  writePrivate,
  localAuthLink,
  databaseDenied,
  storageDenied,
  unchanged,
  validManifest,
  authErrorCode,
} from "./safety.mjs";
import { cleanupManifest } from "./cleanup.mjs";
const configFile = process.env.RADAR_LAB_CONFIG;
if (!configFile)
  throw Error("RADAR_LAB_CONFIG must point to private local configuration");
const config = privateJSON(configFile);
validateConfig(config);
privateLocations([configFile, config.stateFile, config.evidenceFile]);
const mode = process.argv[2];
if (!["setup", "run", "cleanup"].includes(mode))
  throw Error("Explicit mode setup, run or cleanup required");
const stateFile = config.stateFile,
  evidenceFile = config.evidenceFile;
const exists = fs.existsSync(stateFile);
if (!exists && mode !== "setup")
  throw Error("Existing laboratory manifest required");
const state = exists
  ? privateJSON(stateFile)
  : { run: crypto.randomUUID(), users: {}, records: {}, results: [] };
validManifest(state);
const save = () => writePrivate(stateFile, state);
const check = (ok, code) => {
  if (!ok) throw Object.assign(Error(code), { safeCode: code });
};
async function test(id, fn) {
  try {
    await fn();
    state.results.push({ id, status: "APROVADO" });
  } catch (e) {
    state.results.push({
      id,
      status: "REPROVADO",
      reason: e.safeCode || "REQUEST_FAILED",
    });
  }
  save();
  console.log(id, state.results.at(-1).status);
}
function sql(query) {
  return execFileSync(
    "docker",
    [
      "--host=unix:///var/run/docker.sock",
      "exec",
      "-i",
      config.databaseContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
}
const uuid = (value) => {
  check(/^[a-f0-9-]{36}$/.test(value), "INVALID_FIXTURE_UUID");
  return value;
};
async function request(
  path,
  {
    method = "GET",
    body,
    token,
    key = config.publicKey,
    bytes = false,
    contentType = "application/pdf",
  } = {},
) {
  const headers = { apikey: key };
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined && !bytes)
    headers["Content-Type"] = "application/json";
  if (bytes) headers["Content-Type"] = contentType;
  const r = await fetch(config.url + path, {
    method,
    headers: { ...headers, Prefer: "return=representation" },
    body: body === undefined ? undefined : bytes ? body : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(bytes ? 300000 : 30000),
  });
  const buffer = Buffer.from(await r.arrayBuffer());
  let data = null;
  try {
    data = JSON.parse(buffer.toString());
  } catch {}
  return {
    status: r.status,
    data,
    buffer,
    location: r.headers.get("location"),
  };
}
const admin = (path, opts = {}) =>
  request(path, { ...opts, key: config.adminKey, token: config.adminKey });
async function login(name) {
  const user = state.users[name];
  const r = await request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email: user.email, password: user.password },
  });
  check(r.status === 200 && r.data.user.id === user.id, "LOGIN_FAILED");
  Object.assign(user, {
    access: r.data.access_token,
    refresh: r.data.refresh_token,
    expires: Date.now() + r.data.expires_in * 1000,
  });
  save();
}
async function renew(name) {
  const u = state.users[name];
  const r = await request("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: { refresh_token: u.refresh },
  });
  check(r.status === 200 && r.data.user.id === u.id, "REFRESH_FAILED");
  Object.assign(u, {
    access: r.data.access_token,
    refresh: r.data.refresh_token,
    expires: Date.now() + r.data.expires_in * 1000,
  });
  save();
}
async function as(name, path, opts = {}) {
  const u = state.users[name];
  if (Date.now() + 5000 >= u.expires) await renew(name);
  return request(path, { ...opts, token: u.access });
}
const rest = (name, table, query = "", opts = {}) =>
  as(name, "/rest/v1/" + table + query, opts);
const tables = [
  "legal_clients",
  "legal_cases",
  "legal_events",
  "legal_movements",
  "legal_documents",
];
async function mailLink(email, type) {
  for (let attempt = 0; attempt < 15; attempt++) {
    const r = await fetch(config.mailpit + "/api/v1/messages", {
      signal: AbortSignal.timeout(5000),
      redirect: "manual",
    });
    check(r.status === 200, "MAIL_LIST_FAILED");
    const list = await r.json();
    for (const m of list.messages || []) {
      if (!(m.To || []).some((x) => x.Address === email)) continue;
      const detail = await fetch(
        config.mailpit + "/api/v1/message/" + encodeURIComponent(m.ID),
        { redirect: "manual", signal: AbortSignal.timeout(5000) },
      );
      check(detail.status === 200, "MAIL_DETAIL_FAILED");
      const msg = await detail.json();
      const text = (msg.HTML || msg.Text || "").replaceAll("&amp;", "&");
      const links = text.match(/https?:\/\/[^\s<>"']+/g) || [];
      const link = links.find((x) => {
        try {
          return (
            new URL(x).pathname === "/auth/v1/verify" &&
            new URL(x).searchParams.get("type") === type
          );
        } catch {
          return false;
        }
      });
      if (link) {
        return localAuthLink(link, config.url, type);
      }
    }
    await pause(500);
  }
  throw Object.assign(Error("MAIL_NOT_FOUND"), { safeCode: "MAIL_NOT_FOUND" });
}
async function accept(link) {
  const r = await fetch(link, { redirect: "manual" });
  check(r.status >= 300 && r.status < 400, "VERIFY_NOT_REDIRECT");
  const location = new URL(r.headers.get("location"));
  check(location.origin === "http://127.0.0.1:5517", "BAD_REDIRECT");
  const hash = new URLSearchParams(location.hash.slice(1));
  check(Boolean(hash.get("access_token")), "VERIFY_NO_SESSION");
  return {
    access: hash.get("access_token"),
    refresh: hash.get("refresh_token"),
  };
}
const payload = Buffer.from("%PDF-1.4\nSynthetic laboratory only\n%%EOF\n");
async function setup() {
  check(Object.keys(state.users).length === 0, "STATE_ALREADY_INITIALIZED");
  check(
    sql("select count(*) from auth.users;") === "0",
    "LAB_DATABASE_NOT_EMPTY",
  );
  for (const name of ["A", "B", "C", "D"]) {
    const email = `radar-${state.run}-${name.toLowerCase()}@example.test`,
      password = crypto.randomBytes(24).toString("base64url") + "aA1!";
    state.pendingUsers ??= {};
    state.pendingUsers[name] = { email };
    save();
    const r = await admin(
      name === "A" ? "/auth/v1/invite" : "/auth/v1/admin/users",
      {
        method: "POST",
        body:
          name === "A" ? { email } : { email, password, email_confirm: true },
      },
    );
    check([200, 201].includes(r.status) && r.data.id, "USER_CREATE_FAILED");
    state.users[name] = { id: r.data.id, email, password };
    delete state.pendingUsers[name];
    save();
    if (name === "A") {
      const link = await mailLink(email, "invite");
      const session = await accept(link);
      const updated = await request("/auth/v1/user", {
        method: "PUT",
        token: session.access,
        body: { password },
      });
      check(updated.status === 200, "INVITE_PASSWORD_FAILED");
      state.results.push({
        id: "auth.invite-and-initial-password",
        status: "APROVADO",
      });
    }
  }
  for (const name of ["A", "B", "D"])
    sql(
      `insert into public.legal_access(user_id,enabled,role) values ('${uuid(state.users[name].id)}',true,'${name === "A" ? "administrador" : "advogado"}');`,
    );
  for (const name of ["A", "B", "C", "D"])
    await test("auth.login." + name, () => login(name));
  save();
}
function fixture(name) {
  const u = state.users[name],
    ids = Object.fromEntries(tables.map((t) => [t, crypto.randomUUID()]));
  const path = u.id + "/e2e-" + state.run + ".pdf";
  return {
    ids,
    path,
    bodies: {
      legal_clients: {
        id: ids.legal_clients,
        owner_id: u.id,
        kind: "pf",
        name: "E2E " + state.run + " synthetic " + name,
      },
      legal_cases: {
        id: ids.legal_cases,
        owner_id: u.id,
        client_id: ids.legal_clients,
        title: "E2E " + state.run + " synthetic case " + name,
      },
      legal_events: {
        id: ids.legal_events,
        owner_id: u.id,
        case_id: ids.legal_cases,
        title: "E2E " + state.run + " synthetic event",
        kind: "tarefa",
        starts_at: "2030-01-01T12:00:00Z",
      },
      legal_movements: {
        id: ids.legal_movements,
        owner_id: u.id,
        case_id: ids.legal_cases,
        title: "E2E " + state.run + " synthetic movement",
      },
      legal_documents: {
        id: ids.legal_documents,
        owner_id: u.id,
        case_id: ids.legal_cases,
        name: "e2e-" + state.run + ".pdf",
        storage_path: path,
        size_bytes: payload.length,
        mime_type: "application/pdf",
      },
    },
  };
}
async function integrity() {
  for (const t of tables) {
    const r = await rest("A", t, "?id=eq." + state.records.A.ids[t]);
    check(
      r.status === 200 &&
        r.data.length === 1 &&
        r.data[0].owner_id === state.users.A.id,
      "A_RECORD_CHANGED",
    );
    if (state.baseline?.[t]) unchanged(r.data[0], state.baseline[t]);
  }
  const r = await as(
    "A",
    "/storage/v1/object/authenticated/legal-private/" + state.records.A.path,
  );
  check(r.status === 200 && r.buffer.equals(payload), "A_OBJECT_CHANGED");
}
async function run() {
  check(
    !state.runStarted &&
      !state.cleaned &&
      ["A", "B", "C", "D"].every((name) => state.users[name]?.access),
    "RUN_REQUIRES_FRESH_SETUP",
  );
  state.runStarted = true;
  save();
  for (const name of ["A", "B", "D"]) {
    const f = fixture(name);
    state.records[name] = f;
    save();
    await test("storage.upload." + name, async () => {
      const r = await as(name, "/storage/v1/object/legal-private/" + f.path, {
        method: "POST",
        body: payload,
        bytes: true,
      });
      check(r.status === 200, "UPLOAD_FAILED");
    });
    for (const t of tables)
      await test("own.insert." + name + "." + t, async () => {
        const r = await rest(name, t, "", {
          method: "POST",
          body: f.bodies[t],
        });
        check(
          r.status === 201 && r.data[0].id === f.ids[t],
          "OWN_INSERT_FAILED",
        );
      });
  }
  const originalAccess = state.users.A.access,
    expires = state.users.A.expires;
  for (const name of ["A", "B"])
    for (const t of tables) {
      const id = state.records[name].ids[t];
      await test("own.select." + name + "." + t, async () => {
        const r = await rest(name, t, "?id=eq." + id);
        check(r.status === 200 && r.data.length === 1, "OWN_SELECT_FAILED");
      });
      await test("own.update." + name + "." + t, async () => {
        const r = await rest(name, t, "?id=eq." + id, {
          method: "PATCH",
          body: {
            [t === "legal_clients" || t === "legal_documents"
              ? "name"
              : "title"]: "E2E " + state.run + " updated",
          },
        });
        check(r.status === 200 && r.data.length === 1, "OWN_UPDATE_FAILED");
      });
    }
  state.baseline = {};
  for (const t of tables) {
    const r = await rest("A", t, "?id=eq." + state.records.A.ids[t]);
    check(r.status === 200 && r.data.length === 1, "BASELINE_UNAVAILABLE");
    state.baseline[t] = r.data[0];
  }
  save();
  for (const t of tables)
    for (const method of ["GET", "PATCH", "DELETE"])
      await test("cross.B." + method + "." + t, async () => {
        const r = await rest("B", t, "?id=eq." + state.records.A.ids[t], {
          method,
          ...(method === "PATCH"
            ? { body: { owner_id: state.users.B.id } }
            : {}),
        });
        check(
          r.status === 200 && Array.isArray(r.data) && r.data.length === 0,
          "CROSS_ROWS_VISIBLE",
        );
        await integrity();
      });
  for (const t of tables)
    await test("cross.owner-insert." + t, async () => {
      const b = { ...state.records.A.bodies[t], id: crypto.randomUUID() };
      if (t === "legal_documents")
        b.storage_path =
          state.users.A.id +
          "/e2e-" +
          state.run +
          "-" +
          crypto.randomUUID() +
          ".pdf";
      const r = await rest("B", t, "", { method: "POST", body: b });
      databaseDenied(r);
      await integrity();
    });
  for (const t of [
    "legal_cases",
    "legal_events",
    "legal_movements",
    "legal_documents",
  ])
    await test("cross.reference." + t, async () => {
      const b = { ...state.records.B.bodies[t], id: crypto.randomUUID() };
      if (t === "legal_cases") b.client_id = state.records.A.ids.legal_clients;
      else b.case_id = state.records.A.ids.legal_cases;
      if (t === "legal_documents")
        b.storage_path =
          state.users.B.id +
          "/e2e-" +
          state.run +
          "-" +
          crypto.randomUUID() +
          ".pdf";
      const r = await rest("B", t, "", { method: "POST", body: b });
      databaseDenied(r, ["23503", "42501"]);
      await integrity();
    });
  await test("authorization.D.revoke-active-session", async () => {
    sql(
      `update public.legal_access set enabled=false where user_id='${uuid(state.users.D.id)}';`,
    );
    check(
      (await rest("D", "legal_access", "?user_id=eq." + state.users.D.id))
        .data[0].enabled === false,
      "REVOCATION_NOT_VISIBLE",
    );
  });
  for (const name of ["C", "D"])
    for (const t of tables) {
      await test("unauthorized." + name + ".select." + t, async () => {
        const r = await rest(name, t, "?limit=1");
        check(r.status === 200 && r.data.length === 0, "UNAUTHORIZED_READ");
      });
      await test("unauthorized." + name + ".insert." + t, async () => {
        const b = {
          ...state.records.B.bodies[t],
          id: crypto.randomUUID(),
          owner_id: state.users[name].id,
        };
        if (t === "legal_cases") b.client_id = null;
        if (t !== "legal_clients" && t !== "legal_cases")
          b.case_id = state.records.B.ids.legal_cases;
        if (t === "legal_documents")
          b.storage_path =
            state.users[name].id +
            "/e2e-" +
            state.run +
            "-" +
            crypto.randomUUID() +
            ".pdf";
        const r = await rest(name, t, "", { method: "POST", body: b });
        databaseDenied(r);
        await integrity();
      });
    }
  for (const name of ["A", "B", "C", "D"])
    for (const t of ["legal_access", "legal_audit_logs"])
      for (const method of ["POST", "PATCH", "DELETE"])
        await test("permissions." + name + "." + method + "." + t, async () => {
          const r = await rest(
            name,
            t,
            t === "legal_access"
              ? "?user_id=eq." + state.users[name].id
              : "?owner_id=eq." + state.users[name].id,
            {
              method,
              ...(method !== "DELETE"
                ? {
                    body:
                      t === "legal_access"
                        ? {
                            user_id: state.users[name].id,
                            enabled: true,
                            role: "administrador",
                          }
                        : { owner_id: state.users[name].id },
                  }
                : {}),
            },
          );
          databaseDenied(r);
          await integrity();
        });
  await test("audit.generated-and-isolated", async () => {
    for (const name of ["A", "B"]) {
      const r = await rest(
        name,
        "legal_audit_logs",
        "?owner_id=eq." + state.users[name].id,
      );
      check(
        r.status === 200 &&
          r.data.length >= 10 &&
          r.data.every(
            (x) =>
              x.owner_id === state.users[name].id &&
              x.actor_id === state.users[name].id,
          ),
        "AUDIT_INVALID",
      );
      const other = await rest(
        name,
        "legal_audit_logs",
        "?owner_id=eq." + state.users[name === "A" ? "B" : "A"].id,
      );
      check(
        other.status === 200 && other.data.length === 0,
        "AUDIT_CROSS_VISIBLE",
      );
    }
  });
  for (const name of ["B", "C", "D"]) {
    await test("storage.cross-download." + name, async () => {
      const r = await as(
        name,
        "/storage/v1/object/authenticated/legal-private/" +
          state.records.A.path,
      );
      storageDenied(r);
      await integrity();
    });
    await test("storage.cross-delete." + name, async () => {
      const denied = await as(name, "/storage/v1/object/legal-private", {
        method: "DELETE",
        body: { prefixes: [state.records.A.path] },
      });
      if (denied.status !== 200) storageDenied(denied);
      else
        check(
          Array.isArray(denied.data) && denied.data.length === 0,
          "CROSS_DELETE_REPORTED_ROWS",
        );
      await integrity();
    });
    await test("storage.cross-list." + name, async () => {
      const r = await as(name, "/storage/v1/object/list/legal-private", {
        method: "POST",
        body: { prefix: state.users.A.id, limit: 100 },
      });
      check(r.status === 200 && r.data.length === 0, "CROSS_LIST_VISIBLE");
      await integrity();
    });
  }
  await test("storage.own-download-and-list", async () => {
    const r = await as(
      "B",
      "/storage/v1/object/authenticated/legal-private/" + state.records.B.path,
    );
    check(r.status === 200 && r.buffer.equals(payload), "OWN_DOWNLOAD_FAILED");
    const list = await as("B", "/storage/v1/object/list/legal-private", {
      method: "POST",
      body: { prefix: state.users.B.id, limit: 100 },
    });
    check(list.status === 200 && list.data.length >= 1, "OWN_LIST_FAILED");
  });
  await test("storage.max-size", async () => {
    const path =
      state.users.B.id +
      "/e2e-" +
      state.run +
      "-" +
      crypto.randomUUID() +
      ".pdf";
    state.extraPaths ??= [];
    state.extraPaths.push(path);
    save();
    const bytes = Buffer.alloc(10485760, 32);
    const r = await as("B", "/storage/v1/object/legal-private/" + path, {
      method: "POST",
      body: bytes,
      bytes: true,
    });
    check(r.status === 200, "MAX_SIZE_REJECTED");
    await as("B", "/storage/v1/object/legal-private", {
      method: "DELETE",
      body: { prefixes: [path] },
    });
    const big = await as("B", "/storage/v1/object/legal-private/" + path, {
      method: "POST",
      body: Buffer.alloc(10485761, 32),
      bytes: true,
    });
    storageDenied(big, "size");
  });
  for (const t of tables)
    await test("cross.owner-update." + t, async () => {
      const id = state.records.B.ids[t];
      const r = await rest("B", t, "?id=eq." + id, {
        method: "PATCH",
        body: { owner_id: state.users.A.id },
      });
      databaseDenied(r);
      check(
        (await rest("B", t, "?id=eq." + id)).data[0].owner_id ===
          state.users.B.id,
        "B_OWNER_CHANGED",
      );
      await integrity();
    });
  for (const name of ["C", "D"])
    for (const t of tables)
      for (const method of ["PATCH", "DELETE"])
        await test(
          "unauthorized." + name + "." + method + "." + t,
          async () => {
            const id = state.records[name === "D" ? "D" : "A"].ids[t];
            const before = sql(
              `select row_to_json(f) from public.${t} f where id='${uuid(id)}';`,
            );
            const r = await rest(name, t, "?id=eq." + id, {
              method,
              ...(method === "PATCH"
                ? { body: { owner_id: state.users[name].id } }
                : {}),
            });
            check(
              r.status === 200 && r.data.length === 0,
              "UNAUTHORIZED_MUTATION",
            );
            check(
              sql(
                `select row_to_json(f) from public.${t} f where id='${uuid(id)}';`,
              ) === before,
              "ORIGINAL_DELETED",
            );
            await integrity();
          },
        );
  for (const [type, ext] of [
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "docx",
    ],
    ["text/plain", "txt"],
  ])
    await test("storage.mime." + ext, async () => {
      const path = state.users.B.id + "/e2e-" + state.run + "." + ext;
      state.extraPaths ??= [];
      state.extraPaths.push(path);
      save();
      const r = await as("B", "/storage/v1/object/legal-private/" + path, {
        method: "POST",
        body: payload,
        bytes: true,
        contentType: type,
      });
      if (type === "text/plain") storageDenied(r, "mime");
      else check(r.status === 200, "MIME_POLICY_FAILED");
    });
  for (const name of ["B", "C", "D"])
    await test("storage.cross-upload." + name, async () => {
      const path =
        state.users.A.id +
        "/e2e-" +
        state.run +
        "-" +
        crypto.randomUUID() +
        ".pdf";
      state.extraPaths ??= [];
      state.extraPaths.push(path);
      save();
      const r = await as(name, "/storage/v1/object/legal-private/" + path, {
        method: "POST",
        body: payload,
        bytes: true,
      });
      storageDenied(r);
      await integrity();
    });
  await test("auth.invalid-credentials", async () => {
    const r = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: {
        email: state.users.A.email,
        password: "wrong-synthetic-password",
      },
    });
    check(
      r.status === 400 && authErrorCode(r) === "invalid_credentials",
      "INVALID_CREDENTIALS_ACCEPTED",
    );
  });
  await test("auth.refresh", () => renew("A"));
  await test("auth.recovery-and-password", async () => {
    const u = state.users.A;
    const r = await request(
      "/auth/v1/recover?redirect_to=" +
        encodeURIComponent("http://127.0.0.1:5517/juridico/portal"),
      { method: "POST", body: { email: u.email } },
    );
    check(r.status === 200, "RECOVERY_FAILED");
    const link = await mailLink(u.email, "recovery");
    const s = await accept(link);
    u.password = crypto.randomBytes(24).toString("base64url") + "aA1!";
    const changed = await request("/auth/v1/user", {
      method: "PUT",
      token: s.access,
      body: { password: u.password },
    });
    check(changed.status === 200, "RESET_FAILED");
    await login("A");
  });
  await test("auth.expired-real-token", async () => {
    const wait = Math.max(0, expires - Date.now() + 1500);
    if (wait) await pause(wait);
    const r = await request("/rest/v1/legal_clients?limit=1", {
      token: originalAccess,
    });
    check(
      r.status === 401 &&
        ["PGRST301", "PGRST303"].includes(r.data?.code) &&
        /expir/i.test(r.data?.message || ""),
      "EXPIRED_TOKEN_NOT_PROVEN",
    );
  });
  await test("auth.logout-and-reentry", async () => {
    const u = state.users.A,
      refresh = u.refresh;
    const r = await as("A", "/auth/v1/logout", { method: "POST" });
    check([200, 204].includes(r.status), "LOGOUT_FAILED");
    const old = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: { refresh_token: refresh },
    });
    check(
      [400, 401].includes(old.status) &&
        [
          "refresh_token_not_found",
          "refresh_token_already_used",
          "session_not_found",
        ].includes(authErrorCode(old)),
      "LOGOUT_REFRESH_NOT_PROVEN",
    );
    await login("A");
  });
  for (const t of [
    "legal_documents",
    "legal_movements",
    "legal_events",
    "legal_cases",
    "legal_clients",
  ])
    await test("own.delete.B." + t, async () => {
      const id = state.records.B.ids[t];
      const r = await rest("B", t, "?id=eq." + id, { method: "DELETE" });
      check(r.status === 200 && r.data.length === 1, "OWN_DELETE_FAILED");
      check(
        (await rest("B", t, "?id=eq." + id)).data.length === 0,
        "OWN_DELETE_NOT_EFFECTIVE",
      );
      await integrity();
    });
  await test("storage.own-delete.B", async () => {
    const r = await as("B", "/storage/v1/object/legal-private", {
      method: "DELETE",
      body: { prefixes: [state.records.B.path] },
    });
    check(r.status === 200, "OWN_DELETE_FAILED");
    check(
      (
        await as(
          "B",
          "/storage/v1/object/authenticated/legal-private/" +
            state.records.B.path,
        )
      ).status !== 200,
      "OWN_DELETE_NOT_EFFECTIVE",
    );
  });
  // Preserve A/D fixtures and accounts for the browser phase; cleanup is explicit.
}
async function cleanup() {
  await cleanupManifest(state, { admin, sql, save });
  state.results.push({ id: "fixtures.cleanup", status: "APROVADO" });
  save();
  console.log("cleanup verified for laboratory manifest");
}

const resultStart = state.results.length;
try {
  if (mode === "setup") {
    await setup();
  } else if (mode === "cleanup") {
    await cleanup();
  } else await run();
} catch (e) {
  state.results.push({
    id: mode === "cleanup" ? "fixtures.cleanup" : "suite.infrastructure",
    status: mode === "cleanup" ? "REPROVADO" : "BLOQUEADO",
    reason: e.safeCode || "EXECUTION_FAILED",
  });
  process.exitCode = 1;
  save();
}
const summary = {
  run: state.run,
  phase: mode,
  phase_counts: Object.fromEntries(
    ["APROVADO", "REPROVADO", "BLOQUEADO"].map((status) => [
      status,
      state.results.slice(resultStart).filter((x) => x.status === status)
        .length,
    ]),
  ),
  environment: "real-local-supabase",
  counts: Object.fromEntries(
    ["APROVADO", "REPROVADO", "BLOQUEADO"].map((s) => [
      s,
      state.results.filter((x) => x.status === s).length,
    ]),
  ),
  results: state.results,
  cleaned: !!state.cleaned,
};
fs.writeFileSync(evidenceFile, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary.counts));
if (summary.phase_counts.REPROVADO || summary.phase_counts.BLOQUEADO)
  process.exitCode = 1;
