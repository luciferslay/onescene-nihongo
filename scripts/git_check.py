# /// script
# requires-python = ">=3.12"
# ///
"""在 Mac 本机检查 git 远程连通性与推送状态（VM 里连不上 GitHub，只能这样查）。"""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args, cwd=ROOT):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=120)
    return (p.stdout + p.stderr).strip()


print("== remote ==\n", run("git", "remote", "-v"))
print("== status ==\n", run("git", "status", "-sb"))
print("== 本地提交数 ==", run("git", "rev-list", "--count", "HEAD"))
print("== ls-remote（能不能连上 GitHub） ==\n", run("git", "ls-remote", "--heads", "origin")[:800])
print("== 凭据 helper ==\n", run("git", "config", "--get", "credential.helper"))
print("== GitHub Desktop 里登记的仓库 ==")
cfg = Path.home() / "Library/Application Support/GitHub Desktop/.git-desktop-repositories.json"
alt = Path.home() / "Library/Application Support/GitHub Desktop"
print("  ", alt.exists() and [p.name for p in alt.iterdir()][:12])
