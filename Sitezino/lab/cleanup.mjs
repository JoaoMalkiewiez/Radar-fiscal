import { requireCheck, validManifest, authErrorCode } from "./safety.mjs";
const tables = [
  "legal_documents",
  "legal_movements",
  "legal_events",
  "legal_cases",
  "legal_clients",
];
// Dependencies are injectable for unit failure tests; real runner supplies actual HTTP/psql.
export async function cleanupManifest(state, { admin, sql, save }) {
  validManifest(state);
  state.cleaned = false;
  save();
  requireCheck(Object.keys(state.users).length > 0, "CLEANUP_EMPTY_MANIFEST");
  requireCheck(
    Object.keys(state.pendingUsers || {}).length === 0,
    "CLEANUP_PENDING_USERS",
  );
  const keys = [
    ...new Set([
      ...(state.extraPaths || []),
      ...Object.values(state.records).map((f) => f.path),
    ]),
  ];
  if (keys.length) {
    const r = await admin("/storage/v1/object/legal-private", {
      method: "DELETE",
      body: { prefixes: keys },
    });
    requireCheck(r.status === 200, "CLEANUP_STORAGE_FAILED");
    const list = keys.map((key) => "'" + key + "'").join(",");
    requireCheck(
      sql(
        `select count(*) from storage.objects where bucket_id='legal-private' and name in (${list});`,
      ) === "0",
      "CLEANUP_OBJECTS_REMAIN",
    );
  }
  for (const table of tables) {
    for (const [name, f] of Object.entries(state.records)) {
      const id = f.ids[table],
        owner = state.users[name].id,
        field =
          table === "legal_clients" || table === "legal_documents"
            ? "name"
            : "title",
        prefix =
          table === "legal_documents" ? "e2e-" + state.run : "E2E " + state.run;
      sql(
        `delete from public.${table} where id='${id}' and owner_id='${owner}' and ${field} like '${prefix}%';`,
      );
      requireCheck(
        sql(`select count(*) from public.${table} where id='${id}';`) === "0",
        "CLEANUP_RECORD_REMAINS",
      );
    }
  }
  for (const u of Object.values(state.users)) {
    const before = await admin("/auth/v1/admin/users/" + u.id);
    // Resumption after an already deleted synthetic account is safe; other failures are not.
    if (before.status === 404 && authErrorCode(before) === "user_not_found")
      continue;
    requireCheck(
      before.status === 200 &&
        before.data?.id === u.id &&
        before.data?.email === u.email,
      "CLEANUP_USER_IDENTITY",
    );
    const removed = await admin("/auth/v1/admin/users/" + u.id, {
      method: "DELETE",
    });
    requireCheck([200, 204].includes(removed.status), "CLEANUP_USER_FAILED");
    const after = await admin("/auth/v1/admin/users/" + u.id);
    requireCheck(
      after.status === 404 && authErrorCode(after) === "user_not_found",
      "CLEANUP_USER_REMAINS",
    );
  }
  state.cleaned = true;
  save();
}
