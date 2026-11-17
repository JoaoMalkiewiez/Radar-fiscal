// Local-only entry: hosted URLs remain forbidden here.
import { privateJSON, validateConfig, privateLocations } from "./safety.mjs";
import { startPortalHarness } from "./portal-server.mjs";
const config = privateJSON(process.env.RADAR_LAB_CONFIG);
validateConfig(config);
privateLocations([process.env.RADAR_LAB_CONFIG]);
startPortalHarness(config);
