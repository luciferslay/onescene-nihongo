# /// script
# requires-python = ">=3.12"
# ///
"""重启本地预览服务，并把这台 Mac 的局域网地址打印到 job 日志。

改动背景：vite.config.ts 里把 server.host 设成 0.0.0.0 之后，预览服务同时监听
局域网地址，手机在同一个 Wi-Fi 下就能直接看，不必每次推到线上。本脚本负责：
1. 重启 launchd 代理 com.business-japanese.dev-server，让新配置生效；
2. 打印所有非回环的 IPv4 地址（Claude 读日志就能把地址发给 Luna）。
"""
from __future__ import annotations

import socket
import subprocess
import time
import urllib.error
import urllib.request

LABEL = "com.business-japanese.dev-server"


def run(*args: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True)
    return (result.stdout or result.stderr).strip()


def lan_addresses() -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for iface in run("ifconfig", "-l").split():
        if iface.startswith(("lo", "utun", "awdl", "llw", "bridge", "gif", "stf")):
            continue
        addr = run("ipconfig", "getifaddr", iface)
        if addr and not addr.startswith("127."):
            found.append((iface, addr))
    return found


def healthy(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def main() -> None:
    uid = run("id", "-u")
    target = f"gui/{uid}/{LABEL}"
    print("kickstart:", run("launchctl", "kickstart", "-k", target) or "ok")

    for _ in range(45):
        if healthy("http://localhost:3100/"):
            break
        time.sleep(2)
    print("localhost:3100 健康:", healthy("http://localhost:3100/"))

    print("主机名:", socket.gethostname())
    addresses = lan_addresses()
    if not addresses:
        print("没找到局域网地址（可能没连 Wi-Fi）")
    for iface, addr in addresses:
        url = f"http://{addr}:3100/"
        print(f"局域网地址 {iface}: {url} 可访问={healthy(url)}")


if __name__ == "__main__":
    main()
