// Hosted entry: lab pinned before server starts; admin key never passed to server.
import { privateJSON, privateLocations, publicKey } from "../safety.mjs";
import { startPortalHarness } from "../portal-server.mjs";
import { loadAuthorization, validateHostedTarget } from "./target.mjs";
const file = process.env.RADAR_HOSTED_LAB_CONFIG;
privateLocations([file]);
const config = privateJSON(file);
validateHostedTarget(config, loadAuthorization());
if (!publicKey(config.publicKey)) throw Error("HOSTED_PUBLIC_KEY_REQUIRED");
startPortalHarness({ url: config.url, publicKey: config.publicKey });
