# /// script
# requires-python = ">=3.12"
# ///
"""本地预览起不来时用：打印占着 3100 / 调试端口的进程，杀掉本项目 node_modules 里残留的 node / workerd，
再由后面的 dev_server_job.py 重新拉起。只杀路径里带本项目目录的进程，不碰韩语站。"""
import subprocess
from pathlib import Path

ROOT = str(Path(__file__).resolve().parents[1])
print(subprocess.run("lsof -nP -iTCP:3100 -iTCP:9229 -iTCP:9230 -iTCP:9231 -sTCP:LISTEN", shell=True, capture_output=True, text=True).stdout)
ps = subprocess.run(["ps", "-axo", "pid,command"], capture_output=True, text=True).stdout.splitlines()
mine = [l for l in ps if ROOT in l and ("node" in l or "workerd" in l) and "dev_doctor" not in l]
print("本项目残留进程：", len(mine))
for l in mine:
    print("  ", l[:200])
subprocess.run(["/bin/launchctl", "bootout", f"gui/{__import__('os').getuid()}/com.business-japanese.dev-server"], capture_output=True)
for l in mine:
    pid = l.strip().split()[0]
    subprocess.run(["kill", "-9", pid])
# 2026-09-23：预览和音频抢 CPU 时，Claude 会临时把 package.json 的 dev 改成 sleep 让出 CPU；这里恢复。
pkg = Path(ROOT) / "package.json"
t = pkg.read_text(encoding="utf-8")
import re
t2 = re.sub(r'"dev": "[^"]*",', '"dev": "vinext dev --port 3100",', t, count=1)
if t2 != t:
    pkg.write_text(t2, encoding="utf-8")
    print("package.json 的 dev 已恢复为 vinext dev --port 3100")
print("已清理，下一步由 dev_server_job.py 重新拉起")
