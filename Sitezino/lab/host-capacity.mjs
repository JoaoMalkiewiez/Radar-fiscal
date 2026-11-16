// Pure capacity decisions, shared by the read-only collector and unit tests.
export function requireCapacity(ok, code) {
  if (!ok) throw Error(code);
}
export function daemonFilesystem(e) {
  requireCapacity(
    e.endpoint?.startsWith("unix:///"),
    "DOCKER_ENDPOINT_UNVERIFIED",
  );
  requireCapacity(
    e.executable === "dockerd" && Number.isInteger(e.pid) && e.pid > 0,
    "DOCKER_PEER_UNVERIFIED",
  );
  requireCapacity(
    e.clientMount === e.daemonMount &&
      Boolean(e.clientMount) &&
      e.clientRoot === e.daemonRoot &&
      Boolean(e.clientRoot),
    "DOCKER_FILESYSTEM_UNVERIFIED",
  );
  requireCapacity(
    Number.isFinite(e.freeBytes) && e.freeBytes >= 0,
    "DOCKER_DISK_UNKNOWN",
  );
  return e.freeBytes;
}
export function memoryCapacity(hostTotal, hostAvailable, dockerTotal, groups) {
  requireCapacity(
    [hostTotal, hostAvailable, dockerTotal].every(
      (x) => Number.isFinite(x) && x > 0,
    ) && hostAvailable <= hostTotal,
    "MEMORY_UNKNOWN",
  );
  requireCapacity(
    Array.isArray(groups) && groups.length > 0,
    "CGROUP_MEMORY_UNKNOWN",
  );
  let capacity = Math.min(hostTotal, dockerTotal),
    available = Math.min(hostAvailable, capacity);
  for (const group of groups) {
    requireCapacity(
      group &&
        (group.limit === "max" ||
          (Number.isFinite(group.limit) && group.limit > 0)) &&
        Number.isFinite(group.current) &&
        group.current >= 0,
      "CGROUP_MEMORY_UNKNOWN",
    );
    if (group.limit !== "max") {
      capacity = Math.min(capacity, group.limit);
      available = Math.min(available, Math.max(0, group.limit - group.current));
    }
  }
  requireCapacity(capacity >= 8e9, "MEMORY_CAPACITY_BELOW_8_GB");
  requireCapacity(available >= 6e9, "MEMORY_HEADROOM_BELOW_6_GB");
  return { capacity, available };
}
