"""Read-only Linux collector. No containers, pulls, installation or hosted access."""
import json
import os
import socket
import struct
import sys
from pathlib import Path


def check(ok, code):
    if not ok:
        raise ValueError(code)


def identity(p):
    s = os.stat(p)
    return f"{s.st_dev}:{s.st_ino}"


def memory_groups(pid):
    # Only unified cgroup v2 is supported. Unknown/v1 layouts fail closed.
    rows = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    entries = [r[3:] for r in rows if r.startswith("0::")]
    check(len(entries) == 1, "CGROUP_MEMORY_UNKNOWN")
    cg = entries[0]
    check(cg.startswith("/") and ".." not in cg.split("/"), "CGROUP_MEMORY_UNKNOWN")
    mounts = []
    for row in Path("/proc/self/mountinfo").read_text().splitlines():
        fields = row.split()
        if " - cgroup2 " in row:
            mounts.append((fields[3], fields[4]))
    check(len(mounts) == 1, "CGROUP_MEMORY_UNKNOWN")
    root, mount = mounts[0]
    check("\\" not in root + mount, "CGROUP_MEMORY_UNKNOWN")
    # A cgroup namespace can hide limiting ancestors. Never assume they are unlimited.
    check(root == "/", "CGROUP_ANCESTORS_UNVERIFIED")
    base = Path(mount)
    leaf = base / cg.lstrip("/")
    result = []
    for folder in [leaf, *leaf.parents]:
        if folder == base:
            break  # cgroup root has no memory.max; host MemAvailable is the bound.
        check(base in folder.parents, "CGROUP_MEMORY_UNKNOWN")
        limit = (folder / "memory.max").read_text().strip()
        current = int((folder / "memory.current").read_text().strip())
        result.append({"limit": "max" if limit == "max" else int(limit), "current": current})
    # Explicit root observation, not a missing/unreadable group.
    return result or [{"limit": "max", "current": 0}]


def verify_cgroup_namespace(pid):
    # Hidden cgroup ancestry is unverifiable even if the current namespace says '/'.
    # Linux UAPI proc_ns.h: PROC_CGROUP_INIT_INO. A nested cgroup namespace
    # can hide tighter parent limits even when its mount root is '/'. Unknown
    # kernels/layouts deliberately fail closed rather than assume no ancestors.
    initial = "cgroup:[4026531835]"
    check(os.readlink("/proc/self/ns/cgroup") == os.readlink("/proc/1/ns/cgroup") == os.readlink(f"/proc/{pid}/ns/cgroup") == initial, "CGROUP_ANCESTORS_UNVERIFIED")

def collect(endpoint, docker_root):
    check(endpoint.startswith("unix:///"), "DOCKER_ENDPOINT_UNVERIFIED")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.connect(endpoint[7:])
        pid, _, _ = struct.unpack("3i", s.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    check(pid > 0, "DOCKER_PEER_UNVERIFIED")
    executable = Path(os.readlink(f"/proc/{pid}/exe")).name
    check(executable == "dockerd", "DOCKER_PEER_UNVERIFIED")
    client_mount = os.readlink("/proc/self/ns/mnt")
    daemon_mount = os.readlink(f"/proc/{pid}/ns/mnt")
    client_root, daemon_root = identity("/"), identity(f"/proc/{pid}/root")
    check(client_mount == daemon_mount and client_root == daemon_root, "DOCKER_FILESYSTEM_UNVERIFIED")
    check(Path(docker_root).is_absolute(), "DOCKER_FILESYSTEM_UNVERIFIED")
    # Verify the same directory object through the daemon's root as well.
    check(identity(docker_root) == identity(f"/proc/{pid}/root/{docker_root.lstrip('/')}"), "DOCKER_FILESYSTEM_UNVERIFIED")
    disk = os.statvfs(docker_root)
    mem = {}
    for row in Path("/proc/meminfo").read_text().splitlines():
        key, value = row.split(":", 1)
        if key in ("MemTotal", "MemAvailable"):
            mem[key] = int(value.split()[0]) * 1024
    verify_cgroup_namespace(pid)
    return dict(endpoint=endpoint, pid=pid, executable=executable, clientMount=client_mount,
                daemonMount=daemon_mount, clientRoot=client_root, daemonRoot=daemon_root,
                freeBytes=disk.f_bavail * disk.f_frsize, hostTotal=mem.get("MemTotal"),
                hostAvailable=mem.get("MemAvailable"), groups=memory_groups("self") + memory_groups(pid))


if __name__ == "__main__":
    try:
        print(json.dumps(collect(sys.argv[1], sys.argv[2])))
    except Exception as e:
        code = str(e)
        print(code if code.isupper() and code.replace("_", "").isalnum() else "HOST_CAPACITY_UNVERIFIED", file=sys.stderr)
        sys.exit(1)
