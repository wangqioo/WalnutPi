from dataclasses import dataclass
from datetime import datetime
import os
import socket
import subprocess


@dataclass(frozen=True)
class SystemStatus:
    hostname: str
    time_text: str
    load_1m: float
    mem_percent: int
    disk_percent: int
    ip_address: str
    frp_active: bool
    docker_active: bool


def run_text(command):
    try:
        return subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        ).stdout
    except FileNotFoundError:
        return ""


def parse_mem_percent(text):
    values = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        parts = value.strip().split()
        if parts and parts[0].isdigit():
            values[key] = int(parts[0])
    total = values.get("MemTotal", 0)
    available = values.get("MemAvailable", 0)
    if total <= 0:
        return 0
    used = max(0, total - available)
    return max(0, min(100, round(used * 100 / total)))


def parse_disk_percent(text):
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 6 and parts[-1] == "/" and parts[-2].endswith("%"):
            try:
                return int(parts[-2].rstrip("%"))
            except ValueError:
                return 0
    return 0


def parse_ip_address(text):
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 3 or parts[0] == "lo":
            continue
        for part in parts[2:]:
            if "/" in part and "." in part:
                return part.split("/", 1)[0]
    return "-"


def parse_service_active(text):
    return text.strip() == "active"


def load_average():
    try:
        return float(open("/proc/loadavg", encoding="utf-8").read().split()[0])
    except (OSError, ValueError, IndexError):
        return 0.0


def collect():
    try:
        mem_text = open("/proc/meminfo", encoding="utf-8").read()
    except OSError:
        mem_text = ""

    return SystemStatus(
        hostname=socket.gethostname(),
        time_text=datetime.now().strftime("%H:%M"),
        load_1m=load_average(),
        mem_percent=parse_mem_percent(mem_text),
        disk_percent=parse_disk_percent(run_text(["df", "-h", "/"])),
        ip_address=parse_ip_address(run_text(["ip", "-br", "addr"])),
        frp_active=parse_service_active(run_text(["systemctl", "is-active", "frpc"])),
        docker_active=parse_service_active(run_text(["systemctl", "is-active", "docker"])),
    )


def as_lines(data):
    return [
        f"host={data.hostname}",
        f"time={data.time_text}",
        f"load_1m={data.load_1m:.2f}",
        f"mem={data.mem_percent}%",
        f"disk={data.disk_percent}%",
        f"ip={data.ip_address}",
        f"frp={'active' if data.frp_active else 'inactive'}",
        f"docker={'active' if data.docker_active else 'inactive'}",
    ]

