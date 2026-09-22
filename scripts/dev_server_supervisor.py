#!/usr/bin/env python3
"""Run the local preview and recover it when HTTP health checks repeatedly fail."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEALTH_URL = os.environ.get("DEV_SERVER_HEALTH_URL", "http://localhost:3100/")
CHECK_INTERVAL = float(os.environ.get("DEV_SERVER_CHECK_INTERVAL", "20"))
FAILURE_LIMIT = int(os.environ.get("DEV_SERVER_FAILURE_LIMIT", "3"))
HTTP_TIMEOUT = float(os.environ.get("DEV_SERVER_HTTP_TIMEOUT", "5"))
RESTART_COOLDOWN = float(os.environ.get("DEV_SERVER_RESTART_COOLDOWN", "5"))
STARTUP_TIMEOUT = float(os.environ.get("DEV_SERVER_STARTUP_TIMEOUT", "90"))

stopping = False
child: subprocess.Popen[bytes] | None = None


def log(message: str) -> None:
    stamp = datetime.now().astimezone().isoformat(timespec="seconds")
    print(f"[{stamp}] supervisor: {message}", flush=True)


def healthy() -> bool:
    request = urllib.request.Request(
        HEALTH_URL, headers={"User-Agent": "business-japanese-preview-health/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def stop_child() -> None:
    global child
    if child is None or child.poll() is not None:
        return
    log(f"stopping unhealthy child process group (leader pid {child.pid})")
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=8)
    except ProcessLookupError:
        pass
    except subprocess.TimeoutExpired:
        log("child did not stop after 8s; sending SIGKILL")
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait(timeout=5)


def handle_signal(signum: int, _frame: object) -> None:
    global stopping
    stopping = True
    log(f"received signal {signum}; shutting down")
    stop_child()


def pause(seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while not stopping and time.monotonic() < deadline:
        time.sleep(max(0, min(0.5, deadline - time.monotonic())))


def main() -> int:
    global child
    if len(sys.argv) != 2:
        raise SystemExit("usage: dev_server_supervisor.py /absolute/path/to/npm")
    npm = sys.argv[1]
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)
    log(
        f"watching {HEALTH_URL}; restart after {FAILURE_LIMIT} consecutive failures "
        f"at {CHECK_INTERVAL:g}s intervals"
    )

    while not stopping:
        child = subprocess.Popen(
            [npm, "run", "dev"],
            cwd=ROOT,
            env=os.environ.copy(),
            start_new_session=True,
        )
        log(f"started npm run dev (pid {child.pid})")

        startup_deadline = time.monotonic() + STARTUP_TIMEOUT
        while not stopping and child.poll() is None and time.monotonic() < startup_deadline:
            if healthy():
                log("HTTP health check passed")
                break
            pause(2)
        else:
            if stopping:
                break
            if child.poll() is None:
                log(f"startup did not become healthy within {STARTUP_TIMEOUT:g}s")
                stop_child()
            else:
                log(f"child exited during startup with code {child.returncode}")
            pause(RESTART_COOLDOWN)
            continue

        failures = 0
        while not stopping and child.poll() is None:
            pause(CHECK_INTERVAL)
            if stopping or child.poll() is not None:
                break
            if healthy():
                if failures:
                    log("HTTP health recovered before restart threshold")
                failures = 0
                continue
            failures += 1
            log(f"HTTP health check failed ({failures}/{FAILURE_LIMIT})")
            if failures >= FAILURE_LIMIT:
                log("health failure threshold reached; restarting preview")
                stop_child()
                break

        if not stopping:
            if child.poll() is not None and failures < FAILURE_LIMIT:
                log(f"child exited with code {child.returncode}; restarting")
            pause(RESTART_COOLDOWN)

    stop_child()
    log("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
