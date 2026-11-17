// Read-only host checks. Never installs, pulls, starts Docker or contacts Supabase.
import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  daemonFilesystem,
  memoryCapacity,
  requireCapacity,
} from "./host-capacity.mjs";
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
try {
  requireCapacity(
    Number(process.versions.node.split(".")[0]) >= 22,
    "NODE_22_REQUIRED",
  );
  accessSync(process.cwd(), constants.W_OK);
  run("docker", ["version", "--format", "{{.Server.Version}}"]);
  const info = JSON.parse(run("docker", ["info", "--format", "{{json .}}"]));
  requireCapacity(
    Boolean(info.DockerRootDir && info.Driver),
    "DOCKER_INFO_INCOMPLETE",
  );
  const context = process.env.DOCKER_CONTEXT;
  const endpoint =
    (!context && process.env.DOCKER_HOST) ||
    JSON.parse(
      run("docker", ["context", "inspect", ...(context ? [context] : [])]),
    )[0]?.Endpoints?.docker?.Host;
  requireCapacity(
    endpoint?.startsWith("unix:///"),
    "DOCKER_ENDPOINT_UNVERIFIED",
  );
  let observed;
  try {
    observed = JSON.parse(
      run("python3", [
        fileURLToPath(new URL("./collect-host-capacity.py", import.meta.url)),
        endpoint,
        info.DockerRootDir,
      ]),
    );
  } catch {
    throw Error("HOST_CAPACITY_UNVERIFIED");
  }
  const freeBytes = daemonFilesystem(observed);
  requireCapacity(
    freeBytes >= 30 * 2 ** 30,
    "DOCKER_DISK_BELOW_30_GIB_PLANNING_MARGIN",
  );
  const memory = memoryCapacity(
    observed.hostTotal,
    observed.hostAvailable,
    info.MemTotal,
    observed.groups,
  );
  requireCapacity(
    info.Driver !== "vfs",
    "VFS_REQUIRES_CAPACITY_REVIEW_BEFORE_PULL",
  );
  console.log(
    JSON.stringify({
      node: process.versions.node,
      driver: info.Driver,
      dockerFreeGiB: +(freeBytes / 2 ** 30).toFixed(1),
      effectiveMemoryGB: +(memory.capacity / 1e9).toFixed(1),
      memoryHeadroomGB: +(memory.available / 1e9).toFixed(1),
    }),
  );
  console.log(
    "Host preflight passed; billing and private ports still require verification. No stack started.",
  );
} catch (error) {
  console.error(
    /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : "PREFLIGHT_UNAVAILABLE_CHECK_DAEMON_STORAGE_ACCESS",
  );
  process.exitCode = 1;
}
