"""Temporary PR12 read-only diagnostics. Observations never override preflight."""
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import sys
sys.dont_write_bytecode = True
from importlib.util import module_from_spec, spec_from_file_location

spec = spec_from_file_location("capacity", Path(__file__).with_name("collect-host-capacity.py"))
capacity = module_from_spec(spec)
spec.loader.exec_module(capacity)
report = {"schema": 1, "purpose": "diagnostic-only-not-capacity-approval", "errors": {}}


def observe(name, fn):
    try:
        value = fn()
        report[name] = value
        return value
    except Exception as error:
        report["errors"][name] = str(error) if isinstance(error, ValueError) and str(error).isupper() and str(error).replace("_", "").isalnum() else type(error).__name__
        return None


def docker(args):
    return subprocess.check_output(["docker", *args], text=True, stderr=subprocess.PIPE, timeout=10).strip()


def meminfo():
    return {k: int(v.split()[0]) * 1024 for k, v in
            (line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
            if k in ("MemTotal", "MemAvailable")}


observe("hostMemoryBytes", meminfo)
observe("clientMountNamespace", lambda: os.readlink("/proc/self/ns/mnt"))
observe("clientCgroupNamespace", lambda: os.readlink("/proc/self/ns/cgroup"))
observe("clientCgroupLimits", lambda: capacity.memory_groups("self"))
info = observe("docker", lambda: {k: v for k, v in json.loads(docker(["info", "--format", "{{json .}}"])).items()
                                 if k in ("Driver", "DockerRootDir", "MemTotal", "NCPU", "ServerVersion")})
if info:
    context = os.environ.get("DOCKER_CONTEXT")
    endpoint = observe("endpoint", lambda: os.environ.get("DOCKER_HOST") if not context and os.environ.get("DOCKER_HOST") else
                       json.loads(docker(["context", "inspect", *([context] if context else [])]))[0]["Endpoints"]["docker"]["Host"])
    # Never print endpoint strings; remote URLs may contain credentials.
    report.pop("endpoint", None)
    report["endpointKind"] = "unix" if endpoint and endpoint.startswith("unix:///") else "unsupported-or-unknown"
    pid = None
    if report["endpointKind"] == "unix":
        def peer():
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
                sock.settimeout(5)
                sock.connect(endpoint[7:])
                return struct.unpack("3i", sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))[0]
        pid = observe("daemonPeerPid", peer)
    if pid and pid > 0:
        observe("daemonExecutable", lambda: Path(os.readlink(f"/proc/{pid}/exe")).name)
        observe("daemonMountNamespace", lambda: os.readlink(f"/proc/{pid}/ns/mnt"))
        observe("daemonCgroupNamespace", lambda: os.readlink(f"/proc/{pid}/ns/cgroup"))
        observe("daemonCgroupLimits", lambda: capacity.memory_groups(pid))
    def verified_disk():
        capacity.check(pid and report.get("daemonExecutable") == "dockerd", "DOCKER_PEER_UNVERIFIED")
        capacity.check(report.get("clientMountNamespace") == report.get("daemonMountNamespace") and report.get("clientMountNamespace"), "DOCKER_FILESYSTEM_UNVERIFIED")
        capacity.check(capacity.identity("/") == capacity.identity(f"/proc/{pid}/root"), "DOCKER_FILESYSTEM_UNVERIFIED")
        root = info["DockerRootDir"]
        capacity.check(capacity.identity(root) == capacity.identity(f"/proc/{pid}/root/{root.lstrip('/')}"), "DOCKER_FILESYSTEM_UNVERIFIED")
        disk = os.statvfs(root)
        return {"total": disk.f_blocks * disk.f_frsize, "available": disk.f_bavail * disk.f_frsize, "equivalenceVerified": True}
    observe("daemonFilesystemBytes", verified_disk)
    # Daemon-reported used bytes only. This is not free capacity.
    observe("daemonDiskUsage", lambda: [{k: v for k, v in json.loads(row).items() if k in ("Type", "TotalCount", "Active", "Size", "Reclaimable")} for row in docker(["system", "df", "--format", "{{json .}}"]).splitlines()])
print(json.dumps(report, sort_keys=True))
