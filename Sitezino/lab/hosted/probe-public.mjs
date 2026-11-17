// Real public API probes only, never classified as authenticated isolation E2E.
import crypto from "node:crypto";
import { privateJSON, privateLocations, writePrivate } from "../safety.mjs";
import { loadAuthorization, hostedRequest } from "./target.mjs";
const file = process.env.RADAR_HOSTED_LAB_CONFIG,
  output = process.argv[2];
privateLocations([file, output]);
const config = privateJSON(file),
  request = hostedRequest(config, loadAuthorization());
const evidence = {
  scope: "REAL_PUBLIC_API_ONLY_NO_AUTHENTICATED_E2E",
  projectRef: config.projectRef,
  results: [],
};
const headers = {
  apikey: config.publicKey,
  "content-type": "application/json",
};
for (const table of [
  "legal_access",
  "legal_clients",
  "legal_cases",
  "legal_events",
  "legal_movements",
  "legal_documents",
  "legal_audit_logs",
]) {
  const r = await request(`/rest/v1/${table}?select=*&limit=1`, { headers });
  const data = await r.json();
  const ok = [401, 403].includes(r.status) && data.code === "42501";
  evidence.results.push({
    id: "anonymous.denied." + table,
    http: r.status,
    code: typeof data.code === "string" ? data.code : null,
    status: ok ? "APROVADO" : "REPROVADO",
  });
}
const r = await request("/auth/v1/token?grant_type=password", {
  method: "POST",
  headers,
  body: JSON.stringify({
    email: `radar-nonexistent-${crypto.randomUUID()}@example.test`,
    password: crypto.randomBytes(24).toString("hex"),
  }),
});
const data = await r.json();
evidence.results.push({
  id: "auth.invalid-credentials",
  http: r.status,
  code: data.error_code || null,
  status:
    r.status === 400 && data.error_code === "invalid_credentials"
      ? "APROVADO"
      : "REPROVADO",
});
writePrivate(output, evidence, true);
console.log(JSON.stringify(evidence));
if (evidence.results.some((x) => x.status !== "APROVADO")) process.exitCode = 1;
