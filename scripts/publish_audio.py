#!/usr/bin/env python3
"""把课程音频的母带 WAV 编码成上线用的 m4a，并把课程数据里的引用改成 .m4a。

用法：
    python3 scripts/publish_audio.py              # 全量（只编码缺失或过期的）
    python3 scripts/publish_audio.py custom-03    # 只处理某一课
    python3 scripts/publish_audio.py --check      # 只检查有没有缺失，不动文件

设计：
- WAV 是母带，留在本地（已在 .gitignore 里排除）；入库和部署的是 m4a，体积约为十分之一。
- 编码参数：AAC 64 kbps、单声道、24 kHz —— 语音够用，听感与 WAV 基本无差。
- 幂等：m4a 比 wav 新就跳过，所以重录某一条之后再跑一次，只会重新编码那一条。
- 同时把 lib/lessons/*.ts 里的 `.wav` 引用改成 `.m4a`（只改 /audio/standard/ 下的路径）。
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "public" / "audio" / "standard"
LESSONS = ROOT / "lib" / "lessons"
SKIP = ("candidate", "rejected")


def wavs(only: str | None) -> list[Path]:
    base = AUDIO / only if only else AUDIO
    return [p for p in sorted(base.rglob("*.wav")) if not any(s in p.name for s in SKIP)]


def encode(src: Path) -> str:
    dst = src.with_suffix(".m4a")
    if dst.exists() and dst.stat().st_mtime >= src.stat().st_mtime:
        return "skip"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src),
         "-c:a", "aac", "-b:a", "64k", "-ac", "1", "-ar", "24000",
         "-movflags", "+faststart", str(dst)],
        check=True,
    )
    return "ok"


def retarget_lessons() -> int:
    changed = 0
    for f in LESSONS.glob("*.ts"):
        t = f.read_text(encoding="utf-8")
        new = re.sub(r"(\$\{AUDIO\}/[\w.-]+)\.wav", r"\1.m4a", t)
        # sample-01 把路径直接写成字面量，没有用 ${AUDIO} 模板，这里一并处理
        new = re.sub(r"(/audio/standard/[\w./-]+)\.wav", r"\1.m4a", new)
        if new != t:
            f.write_text(new, encoding="utf-8")
            changed += 1
    return changed


def main() -> None:
    args = [a for a in sys.argv[1:]]
    check = "--check" in args
    only = next((a for a in args if not a.startswith("-")), None)
    items = wavs(only)
    if not items:
        print("no wav found"); return
    made = skipped = 0
    missing = []
    for src in items:
        dst = src.with_suffix(".m4a")
        if check:
            if not dst.exists():
                missing.append(str(dst.relative_to(ROOT)))
            continue
        if encode(src) == "ok":
            made += 1
        else:
            skipped += 1
    if check:
        print(f"check: {len(items)} wav, {len(missing)} missing m4a")
        for m in missing[:20]:
            print("  missing:", m)
        return
    wav_mb = sum(p.stat().st_size for p in items) / 1e6
    m4a_mb = sum(p.with_suffix(".m4a").stat().st_size for p in items) / 1e6
    print(f"encoded {made}, skipped {skipped}; {wav_mb:.1f} MB wav -> {m4a_mb:.1f} MB m4a")
    print(f"lesson files retargeted to .m4a: {retarget_lessons()}")


if __name__ == "__main__":
    main()
