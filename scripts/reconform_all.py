# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "faster-whisper", "pykakasi"]
# ///
"""对多课依次重跑"定稿"流程（变速对齐 + 音量归一 + 统一裁切），不重新生成语音。

输入：audio-jobs/reconform-all-request.json  {"samples": ["sample-01", ...]}
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    req = json.loads((ROOT / "audio-jobs" / "reconform-all-request.json").read_text(encoding="utf-8"))
    for sample in req["samples"]:
        (ROOT / "audio-jobs" / "reconform-request.json").write_text(
            json.dumps({"sample": sample}, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"\n===== {sample} =====", flush=True)
        r = subprocess.run([sys.executable, str(Path(__file__).with_name("reconform_audio.py"))])
        if r.returncode != 0:
            print(f"!! {sample} failed", flush=True)
    print("\nreconform-all done")


if __name__ == "__main__":
    main()
