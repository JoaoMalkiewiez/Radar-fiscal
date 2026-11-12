// Convert private CLI status output into a private laboratory configuration.
import fs from "node:fs";
import path from "node:path";
const [statusFile, databaseContainer, destination] = process.argv.slice(2);
if (!statusFile || !databaseContainer || !destination)
  throw Error(
    "Usage: node configure-private.mjs STATUS_JSON DB_CONTAINER DESTINATION",
  );
const s = JSON.parse(fs.readFileSync(statusFile, "utf8"));
const config = {
  url: s.API_URL,
  mailpit: s.MAILPIT_URL || s.INBUCKET_URL,
  publicKey: s.PUBLISHABLE_KEY || s.ANON_KEY,
  adminKey: s.SERVICE_ROLE_KEY,
  databaseContainer,
  stateFile: path.resolve(path.dirname(destination), "state.private.json"),
  evidenceFile: path.resolve(
    path.dirname(destination),
    "evidence.sanitized.json",
  ),
};
for (const value of [config.url, config.mailpit]) {
  const u = new URL(value);
  if (u.hostname !== "127.0.0.1" || u.protocol !== "http:")
    throw Error("Only loopback laboratory endpoints are allowed");
}
if (
  !config.publicKey ||
  !config.adminKey ||
  !/^supabase_.*radar/.test(databaseContainer)
)
  throw Error("Missing or unexpected laboratory configuration");
fs.writeFileSync(destination, JSON.stringify(config), {
  mode: 0o600,
  flag: "wx",
});
console.log("Private laboratory configuration created; no credentials printed");
