# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy", "soundfile", "faster-whisper", "pykakasi"]
# ///
"""一课音频的事后体检：检查对话是否被截断、单词是否读得"低落"。

输入：audio-jobs/audit-request.json  {"sample": "custom-03"}
输出：public/audio/standard/<sample>/audit-report.json + 终端摘要

两项检查：
1) 截尾：对每条 dialogue-*.wav 和 *-example.wav 做 ASR，比较转写结尾与原文结尾；
   末尾缺字（尤其是句末 요/다/까 等）判为 truncated。再看波形最后 120 ms 是否仍有声音
   （模型没说完就停）与末端能量是否骤降（被 trim 切掉）。
2) 情绪：统计每条音频的 median F0 与末端 F0 斜率，和该声线 baseline 比较。
   读得低落、悲伤时典型特征是整体音高明显低于 baseline、且句末大幅下坠。
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from term_audio_policy import _jamo, transcribe  # noqa: E402

TAIL_MS = 120
LOW_PITCH_RATIO = 0.90   # median F0 低于 baseline 的九成 → 偏低沉
DROP_RATIO = 0.75        # 句末 F0 低于全句中位数的七成 → 明显下坠


def median_f0(audio: np.ndarray, sr: int) -> float:
    """自相关粗测基频，只取有声帧的中位数。"""
    win = int(sr * 0.04)
    hop = int(sr * 0.02)
    vals = []
    for i in range(0, max(0, len(audio) - win), hop):
        frame = audio[i : i + win]
        if np.sqrt(np.mean(frame**2)) < 10 ** (-40 / 20):
            continue
        frame = frame - frame.mean()
        corr = np.correlate(frame, frame, mode="full")[win - 1 :]
        lo, hi = int(sr / 400), int(sr / 70)
        if hi >= len(corr):
            continue
        peak = int(np.argmax(corr[lo:hi])) + lo
        if peak > 0 and corr[peak] > 0.3 * corr[0]:
            vals.append(sr / peak)
    return float(np.median(vals)) if vals else 0.0


def tail_f0(audio: np.ndarray, sr: int, ms: int = 400) -> float:
    return median_f0(audio[-int(sr * ms / 1000) :], sr)


def tail_alive(audio: np.ndarray, sr: int) -> bool:
    """末尾 TAIL_MS 内仍有明显声音 → 很可能是没说完就被截断。"""
    tail = audio[-int(sr * TAIL_MS / 1000) :]
    return bool(np.sqrt(np.mean(tail**2)) >= 10 ** (-45 / 20))


def tail_match(got: str, want: str, n: int = 3) -> float:
    g, w = _jamo(got)[-n * 3 :], _jamo(want)[-n * 3 :]
    if not w:
        return 1.0
    import difflib

    return round(difflib.SequenceMatcher(None, g, w).ratio(), 3)


def main() -> None:
    req = json.loads((ROOT / "audio-jobs" / "audit-request.json").read_text(encoding="utf-8"))
    sample = req["sample"]
    out = ROOT / "public" / "audio" / "standard" / sample
    cfg = json.loads((ROOT / "audio_voice_presets.json").read_text(encoding="utf-8"))
    rows = []
    for wav in sorted(out.glob("*.wav")):
        if "candidate" in wav.name or "rejected" in wav.name:
            continue
        man_path = wav.with_suffix(".json")
        if not man_path.exists():
            continue
        man = json.loads(man_path.read_text(encoding="utf-8"))
        text = man.get("page_text", "")
        audio, sr = sf.read(wav, always_2d=False)
        audio = np.asarray(audio, dtype=np.float32)
        voice = cfg["voices"][man["voice_id"]]
        base = voice["baseline"]["median_f0_hz"]
        f0 = median_f0(audio, sr)
        tf0 = tail_f0(audio, sr)
        row = {
            "file": wav.name,
            "text": text,
            "duration": round(len(audio) / sr, 3),
            "median_f0": round(f0, 1),
            "baseline_f0": base,
            "f0_vs_baseline": round(f0 / base, 3) if base else 0,
            "tail_f0": round(tf0, 1),
            "tail_vs_median": round(tf0 / f0, 3) if f0 else 0,
            "tail_alive": tail_alive(audio, sr),
            "flags": [],
        }
        is_speech = wav.name.startswith("dialogue-") or wav.name.endswith("-example.wav")
        if is_speech:
            got = transcribe(audio, sr)
            best = max(got.values(), key=len) if got else ""
            row["asr"] = got
            row["tail_match"] = tail_match(best, text)
            if row["tail_match"] < 0.6 or row["tail_alive"]:
                row["flags"].append("truncated?")
        if row["f0_vs_baseline"] and row["f0_vs_baseline"] < LOW_PITCH_RATIO:
            row["flags"].append("low_pitch")
        if row["tail_vs_median"] and row["tail_vs_median"] < DROP_RATIO:
            row["flags"].append("falling_tail")
        rows.append(row)
        if row["flags"]:
            print(f"[FLAG] {wav.name} {row['flags']} f0={row['median_f0']}/{base} "
                  f"tail={row['tail_vs_median']} match={row.get('tail_match')}", flush=True)
    (out / "audit-report.json").write_text(
        json.dumps({"sample": sample, "rows": rows}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    flagged = [r["file"] for r in rows if r["flags"]]
    print(f"audit done: {len(rows)} files, {len(flagged)} flagged")
    if flagged:
        print("flagged: " + ", ".join(flagged))


if __name__ == "__main__":
    main()
