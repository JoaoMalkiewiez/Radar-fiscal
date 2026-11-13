// Convert private CLI status output into a private laboratory configuration.
import path from "node:path";
import {
  privateJSON,
  validateConfig,
  privateLocations,
  writePrivate,
} from "./safety.mjs";
const [statusFile, databaseContainer, destination] = process.argv.slice(2);
if (!statusFile || !databaseContainer || !destination)
  throw Error(
    "Usage: node configure-private.mjs STATUS_JSON DB_CONTAINER DESTINATION",
  );
privateLocations([statusFile, destination]);
const s = privateJSON(statusFile);
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
validateConfig(config);
privateLocations([
  statusFile,
  destination,
  config.stateFile,
  config.evidenceFile,
]);
writePrivate(destination, config, true);
console.log("Private laboratory configuration created; no credentials printed");
