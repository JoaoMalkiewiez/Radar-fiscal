// Offline only: no network, Docker, account creation or database writes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { privateLocations, writePrivate } from "../safety.mjs";
import { loadAuthorization } from "./target.mjs";
const destination = process.argv[2];
if (!destination) throw Error("PRIVATE_OUTPUT_FILE_REQUIRED");
privateLocations([destination]);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const sources = [
  "radar-juridico.sql",
  "authorized-access-and-movements.sql",
  "private-audit-trail.sql",
];
const migrations = sources.map((name) => {
  const sql = fs.readFileSync(path.join(root, "database", name), "utf8");
  return {
    source: `database/${name}`,
    sha256: crypto.createHash("sha256").update(sql).digest("hex"),
    sql,
  };
});
const run = crypto.randomUUID();
const proposal = loadAuthorization();
const users = Object.fromEntries(
  ["A", "B", "C", "D"].map((name) => [
    name,
    {
      email: `radar-${run}-${name.toLowerCase()}@example.test`,
      password: crypto.randomBytes(24).toString("base64url") + "aA1!",
      role: name === "A" ? "administrador" : "advogado",
      authorized: name !== "C",
      revokeDuringRun: name === "D",
    },
  ]),
);
writePrivate(
  destination,
  {
    mode: "OFFLINE_PLAN_NOT_EXECUTED",
    run,
    proposal,
    users,
    migrations,
    prerequisite:
      "Explicit creation approval and immutable lab projectRef required before any network operation",
  },
  true,
);
console.log(
  "Private offline laboratory plan prepared; no accounts, project or migrations created/applied.",
);
