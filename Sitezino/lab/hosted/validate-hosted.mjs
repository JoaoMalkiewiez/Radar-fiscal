// Readiness runner only. Full hosted E2E requires separate reviewed execution.
import { privateJSON, privateLocations, publicKey } from "../safety.mjs";
import {
  loadAuthorization,
  hostedRequest,
  validateHostedTarget,
} from "./target.mjs";
const file = process.env.RADAR_HOSTED_LAB_CONFIG;
if (!file) throw Error("PRIVATE_HOSTED_LAB_CONFIG_REQUIRED");
privateLocations([file]);
const config = privateJSON(file);
const authorization = loadAuthorization();
// Target checked before key use, mode handling or any network activity.
validateHostedTarget(config, authorization);
if (process.argv[2] !== "inspect")
  throw Error("ONLY_EXPLICIT_INSPECT_SUPPORTED");
if (!publicKey(config.publicKey)) throw Error("HOSTED_PUBLIC_KEY_REQUIRED");
const request = hostedRequest(config, authorization);
try {
  const response = await request("/auth/v1/settings", {
    headers: { apikey: config.publicKey },
  });
  if (response.status !== 200) throw Error("SETTINGS_UNAVAILABLE");
  const data = await response.json();
  console.log(
    JSON.stringify({
      mode: "READINESS_ONLY_NOT_E2E",
      authSettingsAvailable: true,
      signupDisabled: data.disable_signup === true,
    }),
  );
} catch {
  throw Error("HOSTED_LAB_INSPECTION_FAILED");
}
