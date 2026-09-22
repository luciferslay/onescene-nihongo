# /// script
# requires-python = ">=3.12"
# ///
"""把本地预览（npm run dev，localhost:3100）变成可自愈的常驻服务。

做的事：
1. 找到 npm（Homebrew / /usr/local / nvm 常见路径）。
2. 写入并加载 launchd 代理 com.business-japanese.dev-server：开机自启并运行 HTTP
   健康检查监督器；连续异常时重启 npm 子进程，日志写到 dev-server.log。
3. 等待 http://localhost:3100/ 返回 200，把结果打印到 job 日志。

就绪判断必须是 HTTP 200；仅仅占用端口不再视为健康。
"""
from __future__ import annotations

import os
import plistlib
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LABEL = "com.business-japanese.dev-server"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG = ROOT / "dev-server.log"
SUPERVISOR = ROOT / "scripts" / "dev_server_supervisor.py"


def healthy() -> bool:
    try:
        with urllib.request.urlopen("http://localhost:3100/", timeout=4) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def find_npm() -> str:
    candidates = [
        "/opt/homebrew/bin/npm",
        "/usr/local/bin/npm",
        "/usr/bin/npm",
        *[str(p) for p in sorted(Path.home().glob(".nvm/versions/node/*/bin/npm"), reverse=True)],
    ]
    for path in candidates:
        if Path(path).exists():
            return path
    raise SystemExit("找不到 npm，请告诉我 npm 的完整路径")


def main() -> None:
    if healthy():
        print("localhost:3100 当前健康；将重新加载为带健康检查的常驻服务")
    npm = find_npm()
    node_bin = str(Path(npm).parent)
    plist = {
        "Label": LABEL,
        "ProgramArguments": ["/usr/bin/python3", str(SUPERVISOR), npm],
        "WorkingDirectory": str(ROOT),
        "EnvironmentVariables": {
            "PATH": f"{node_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
            "NODE_ENV": "development",
            "DEV_SERVER_CHECK_INTERVAL": "20",
            "DEV_SERVER_FAILURE_LIMIT": "3",
            "DEV_SERVER_HTTP_TIMEOUT": "5",
            "DEV_SERVER_RESTART_COOLDOWN": "5",
        },
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(LOG),
        "StandardErrorPath": str(LOG),
        "ProcessType": "Background",
    }
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    PLIST.write_bytes(plistlib.dumps(plist))
    uid = os.getuid()
    subprocess.run(["/bin/launchctl", "bootout", f"gui/{uid}/{LABEL}"], capture_output=True)
    boot = subprocess.run(
        ["/bin/launchctl", "bootstrap", f"gui/{uid}", str(PLIST)], capture_output=True, text=True
    )
    print("launchctl bootstrap:", boot.returncode, boot.stderr.strip()[:200])
    subprocess.run(["/bin/launchctl", "kickstart", "-k", f"gui/{uid}/{LABEL}"], capture_output=True)
    for _ in range(60):
        if healthy():
            print("预览已就绪：http://localhost:3100/")
            return
        time.sleep(2)
    print("等待超时，请看 dev-server.log")


if __name__ == "__main__":
    main()
