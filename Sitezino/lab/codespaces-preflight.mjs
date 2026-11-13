// Read-only host checks. Does not install, pull, start Docker or contact Supabase.
import { execFileSync } from "node:child_process";
import { freemem } from "node:os";
import { accessSync, constants } from "node:fs";
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
try {
  if (Number(process.versions.node.split(".")[0]) < 22)
    throw Error("NODE_22_REQUIRED");
  accessSync(process.cwd(), constants.W_OK);
  run("docker", ["version", "--format", "{{.Server.Version}}"]);
  const info = JSON.parse(run("docker", ["info", "--format", "{{json .}}"]));
  if (!info.DockerRootDir || !info.Driver)
    throw Error("DOCKER_INFO_INCOMPLETE");
  // Must inspect the daemon's storage filesystem, not just the checkout filesystem.
  const df = run("df", ["-Pk", "--", info.DockerRootDir]);
  const row = df.split("\n").at(-1).trim().split(/\s+/);
  const freeBytes = Number(row[3]) * 1024;
  if (!Number.isFinite(freeBytes)) throw Error("DOCKER_DISK_UNKNOWN");
  console.log(
    JSON.stringify({
      node: process.versions.node,
      driver: info.Driver,
      dockerFreeGiB: +(freeBytes / 2 ** 30).toFixed(1),
      availableMemoryGiB: +(freemem() / 2 ** 30).toFixed(1),
    }),
  );
  if (freeBytes < 30 * 2 ** 30)
    throw Error("DOCKER_DISK_BELOW_30_GIB_PLANNING_MARGIN");
  if (freemem() < 8 * 2 ** 30)
    throw Error("MEMORY_BELOW_8_GIB_PLANNING_MARGIN");
  if (info.Driver === "vfs")
    throw Error("VFS_REQUIRES_CAPACITY_REVIEW_BEFORE_PULL");
  console.log(
    "Host preflight passed; billing, private ports and local configuration still require verification. No stack started.",
  );
} catch (error) {
  // External command stderr can contain host details: emit only controlled codes.
  const code = /^[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : "PREFLIGHT_UNAVAILABLE_CHECK_DAEMON_STORAGE_ACCESS";
  console.error(code);
  process.exitCode = 1;
}
