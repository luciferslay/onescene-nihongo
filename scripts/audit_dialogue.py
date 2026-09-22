# /// script
# requires-python = ">=3.12"
# dependencies = ["soundfile", "numpy", "faster-whisper", "pykakasi"]
# ///
"""对话句的事后体检：不重新生成，只把已有的 dialogue-*.wav 跑一遍 ASR + 断崖检测。

起因（2026-09-18）：Luna 听出几条 B 的句尾被切掉。测量发现是模型没生成完，
而对话句此前不过 ASR 转写关，所以溜到了线上。这个脚本用来把既有课程全部体检一遍，
先拿到清单，再决定重录哪些。

读 audio-jobs/dialogue-audit-request.json：{"lessons": ["custom-01", ...]}
结果写 audio-jobs/dialogue-audit-report.json，同时打印成表。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf

from term_audio_policy import check_sentence, tail_cliff, transcribe

ROOT = Path(__file__).resolve().parent.parent
REQ = ROOT / "audio-jobs" / "dialogue-audit-request.json"
OUT = ROOT / "audio-jobs" / "dialogue-audit-report.json"
CLONE_VOICE = None  # 运行时从 audio_voice_presets.json 取 role=B 的声线


def lesson_texts(lesson_id: str) -> dict[str, tuple[str, str]]:
    """从课程 .ts 里取出 6 句对话的原文与说话人（A/B）。"""
    out: dict[str, tuple[str, str]] = {}
    for ts in (ROOT / "lib" / "lessons").glob("*.ts"):
        src = ts.read_text(encoding="utf-8")
        if not re.search(rf"^  id: '{re.escape(lesson_id)}',", src, re.M):
            continue
        pairs = re.findall(
            r"role: '(A|B)',\n      text: '((?:[^'\\]|\\.)*)',", src
        )
        for i, (role, text) in enumerate(pairs, start=1):
            out[f"dialogue-{i:02d}.wav"] = (role, text.replace("\\'", "'"))
        break
    return out


def main() -> None:
    lessons = json.loads(REQ.read_text(encoding="utf-8"))["lessons"]
    report = []
    for lesson in lessons:
        texts = lesson_texts(lesson)
        folder = ROOT / "public" / "audio" / "standard" / lesson
        for name, (role, target) in sorted(texts.items()):
            path = folder / name
            if not path.exists():
                continue
            audio, sr = sf.read(path, always_2d=False)
            audio = np.asarray(audio, dtype=np.float32)
            cliff = tail_cliff(audio, sr)
            sent = check_sentence(transcribe(audio, sr), target)
            limit = -20.0 if role == "B" else -18.0
            cliff_ok = cliff["margin_db"] is None or cliff["margin_db"] <= limit
            row = {
                "lesson": lesson,
                "file": name,
                "role": role,
                "voice": role,
                "target": target,
                "margin_db": cliff["margin_db"],
                "cliff_db": cliff["cliff_db"],
                "cliff_ok": cliff_ok,
                "ratio": sent["ratio"],
                "tail_ratio": sent["tail_ratio"],
                "lead_filler": sent["lead_filler"],
                "asr_ok": sent["pass"],
                "transcripts": sent["by_model"],
                "ok": cliff_ok and sent["pass"],
            }
            report.append(row)
            flag = "" if row["ok"] else "  <- " + ",".join(
                k for k, v in (
                    ("句尾断崖", not cliff_ok),
                    ("句首语气词", sent["lead_filler"]),
                    ("整句不符", sent["ratio"] < 0.88),
                    ("句尾不符", sent["tail_ratio"] < 0.80),
                ) if v
            )
            print(
                f"[{'OK ' if row['ok'] else 'BAD'}] {lesson} {name} ({role}) "
                f"margin={row['margin_db']} ratio={row['ratio']} tail={row['tail_ratio']}{flag}",
                flush=True,
            )
    bad = [r for r in report if not r["ok"]]
    OUT.write_text(
        json.dumps({"checked": len(report), "bad": bad, "all": report}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"\n体检完成：{len(report)} 条，疑似有问题 {len(bad)} 条，清单写进 {OUT.name}")
    for r in bad:
        print(f"  - {r['lesson']} {r['file']} ({r['role']}) {r['target'][:40]}")


if __name__ == "__main__":
    main()
