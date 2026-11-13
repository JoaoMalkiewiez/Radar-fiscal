// Local-laboratory boundaries and result oracles. Never authorization for production.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
export function requireCheck(ok, code) {
  if (!ok) throw Object.assign(Error(code), { safeCode: code });
}
export function localBase(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    throw Error("Invalid loopback laboratory URL");
  }
  requireCheck(
    u.protocol === "http:" &&
      u.hostname === "127.0.0.1" &&
      !u.username &&
      !u.password &&
      u.pathname === "/" &&
      !u.search &&
      !u.hash,
    "Only clean loopback HTTP origins are permitted",
  );
  return u;
}
// Email action URLs carry secrets: reject with a fixed message only.
export function localAuthLink(value, apiBase, expectedType) {
  const fail = () => requireCheck(false, "INVALID_LOCAL_AUTH_LINK");
  try {
    const base = localBase(apiBase);
    const u = new URL(value);
    if (
      !["invite", "recovery"].includes(expectedType) ||
      u.protocol !== "http:" ||
      u.hostname !== "127.0.0.1" ||
      u.origin !== base.origin ||
      u.username ||
      u.password ||
      u.hash ||
      u.pathname !== "/auth/v1/verify"
    )
      fail();
    const allowed = ["token", "type", "redirect_to"];
    for (const key of u.searchParams.keys()) {
      if (!allowed.includes(key) || u.searchParams.getAll(key).length !== 1)
        fail();
    }
    if (
      !u.searchParams.get("token") ||
      u.searchParams.get("type") !== expectedType ||
      (u.searchParams.has("redirect_to") &&
        u.searchParams.get("redirect_to") !==
          "http://127.0.0.1:5517/juridico/portal")
    )
      fail();
    return u;
  } catch {
    fail();
  }
}

function role(key) {
  try {
    return JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString())
      .role;
  } catch {
    return null;
  }
}
export function publicKey(key) {
  return (
    typeof key === "string" &&
    (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key) || role(key) === "anon")
  );
}
export function validateConfig(c) {
  const api = localBase(c.url),
    mail = localBase(c.mailpit);
  requireCheck(
    api.origin !== mail.origin && api.origin !== "http://127.0.0.1:5517",
    "LAB_ORIGIN_COLLISION",
  );
  requireCheck(
    publicKey(c.publicKey) &&
      typeof c.adminKey === "string" &&
      role(c.adminKey) === "service_role" &&
      c.adminKey !== c.publicKey,
    "LAB_KEY_SEPARATION",
  );
  requireCheck(
    /^supabase_[a-z0-9_-]*radar[a-z0-9_-]*$/.test(c.databaseContainer),
    "LAB_DATABASE_NAME",
  );
}
export function privateJSON(file) {
  try {
    requireCheck(!fs.lstatSync(file).isSymbolicLink(), "PRIVATE_FILE_SYMLINK");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw Error("Invalid private laboratory JSON");
  }
}
export function privateLocations(files) {
  const repo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const resolved = files.map((file) => {
    requireCheck(typeof file === "string", "PRIVATE_PATH_REQUIRED");
    return path.join(
      fs.realpathSync(path.dirname(path.resolve(file))),
      path.basename(file),
    );
  });
  requireCheck(
    new Set(resolved).size === resolved.length,
    "PRIVATE_FILE_COLLISION",
  );
  for (const file of resolved) {
    const relative = path.relative(repo, file);
    requireCheck(
      relative.startsWith(".." + path.sep) || path.isAbsolute(relative),
      "PRIVATE_FILE_IN_REPOSITORY",
    );
    if (fs.existsSync(file))
      requireCheck(
        !fs.lstatSync(file).isSymbolicLink(),
        "PRIVATE_FILE_SYMLINK",
      );
  }
}
export function writePrivate(file, value, exclusive = false) {
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    (exclusive ? fs.constants.O_EXCL : fs.constants.O_TRUNC) |
    (fs.constants.O_NOFOLLOW || 0);
  const fd = fs.openSync(file, flags, 0o600);
  try {
    fs.fchmodSync(fd, 0o600);
    fs.writeFileSync(fd, JSON.stringify(value));
  } finally {
    fs.closeSync(fd);
  }
}
export function databaseDenied(r, codes = ["42501"]) {
  requireCheck(
    [400, 401, 403, 409].includes(r.status) && codes.includes(r.data?.code),
    "EXPECTED_DATABASE_DENIAL",
  );
}
export function storageDenied(r, kind = "access") {
  const code = r.data?.code || r.data?.error;
  const legacy = Number(r.data?.statusCode);
  const valid =
    kind === "size"
      ? code === "EntityTooLarge" || legacy === 413 || r.status === 413
      : kind === "mime"
        ? code === "InvalidMimeType" || legacy === 415
        : code === "AccessDenied" ||
          code === "NoSuchKey" ||
          [403, 404].includes(legacy) ||
          [403, 404].includes(r.status);
  requireCheck(
    [400, 403, 404, 413, 415].includes(r.status) && valid,
    "EXPECTED_STORAGE_DENIAL",
  );
}
export function unchanged(actual, expected) {
  requireCheck(isDeepStrictEqual(actual, expected), "FIXTURE_CONTENT_CHANGED");
}
export function validManifest(s) {
  requireCheck(
    /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(s.run),
    "INVALID_RUN_ID",
  );
  requireCheck(
    s.users && s.records && Array.isArray(s.results),
    "INVALID_MANIFEST",
  );
  const ids = new Set();
  for (const [name, u] of Object.entries(s.users)) {
    requireCheck(
      ["A", "B", "C", "D"].includes(name) &&
        /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(u.id) &&
        u.email === `radar-${s.run}-${name.toLowerCase()}@example.test` &&
        !ids.has(u.id),
      "INVALID_USER_MANIFEST",
    );
    ids.add(u.id);
  }
  for (const [name, f] of Object.entries(s.records)) {
    requireCheck(
      ["A", "B", "D"].includes(name) &&
        s.users[name] &&
        f.bodies &&
        f.ids &&
        Object.keys(f.ids).length === 5 &&
        [
          "legal_clients",
          "legal_cases",
          "legal_events",
          "legal_movements",
          "legal_documents",
        ].every((t) => f.ids[t]),
      "INVALID_RECORD_MANIFEST",
    );
    for (const [table, id] of Object.entries(f.ids)) {
      requireCheck(
        [
          "legal_clients",
          "legal_cases",
          "legal_events",
          "legal_movements",
          "legal_documents",
        ].includes(table) &&
          /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id) &&
          f.bodies[table]?.id === id &&
          f.bodies[table]?.owner_id === s.users[name].id,
        "INVALID_RECORD_OWNER",
      );
    }
  }
  for (const key of [
    ...Object.values(s.records).map((f) => f.path),
    ...(s.extraPaths || []),
  ])
    requireCheck(
      typeof key === "string" &&
        ids.has(key.split("/")[0]) &&
        /^[-a-zA-Z0-9_/.]+$/.test(key) &&
        !key.includes("..") &&
        key.split("/")[1]?.startsWith("e2e-" + s.run),
      "INVALID_OBJECT_MANIFEST",
    );
}

export function authErrorCode(response) {
  return (
    response.data?.error_code ||
    (typeof response.data?.code === "string" ? response.data.code : null)
  );
}
