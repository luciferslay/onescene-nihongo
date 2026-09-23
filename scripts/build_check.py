# /// script
# requires-python = ">=3.12"
# ///
"""在 Mac 本机跑生产构建（npm run build），把结果写进 job 日志。部署前用。"""
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
npm = next((p for p in ("/opt/homebrew/bin/npm", "/usr/local/bin/npm", "/usr/bin/npm") if Path(p).exists()), "npm")
env = {**os.environ, "PATH": f"{Path(npm).parent}:/usr/bin:/bin:/usr/sbin:/sbin"}
p = subprocess.run([npm, "run", "build"], cwd=ROOT, capture_output=True, text=True, env=env, timeout=1800)
out = (p.stdout + p.stderr)
print(out[-6000:])
print("exit", p.returncode)
