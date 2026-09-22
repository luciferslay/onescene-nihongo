# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "faster-whisper", "pykakasi"]
# ///
"""把一课已经生成好的音频重新走一遍"定稿"流程：变速对齐 + 音量归一 + 统一裁切，
并重新计算语气（prosody）与音色（timbre）指标，写回 manifest。

用途：生成脚本此前有个 bug —— 最后挑中候选时用的是归一前的音频，
导致文件的音量和语速其实没被对齐（어림잡다 比 지적받다 轻了约 9 dB 就是这么来的）。
这个脚本不重新生成语音，只对已有文件做后处理，几秒钟跑完一课。

输入：audio-jobs/reconform-request.json  {"sample": "custom-04"}
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from standardized_course_tts import ROOT as R, conform_existing, load_config  # noqa: E402
from term_audio_policy import accept_best_timbre, prosody_check, timbre_check  # noqa: E402


def main() -> None:
    req = json.loads((ROOT / "audio-jobs" / "reconform-request.json").read_text(encoding="utf-8"))
    sample = req["sample"]
    base = ROOT / "public" / "audio" / "standard"
    out = base if sample in (".", "") else base / sample
    config = load_config()
    changed = []
    for wav in sorted(out.glob("*.wav")):
        if "candidate" in wav.name or "rejected" in wav.name:
            continue
        mf = wav.with_suffix(".json")
        if not mf.exists():
            continue
        old = json.loads(mf.read_text(encoding="utf-8"))
        text = old.get("page_text") or old.get("text", "")
        voice_id = old["voice_id"]
        voice = config["voices"][voice_id]
        before, _sr = sf.read(wav, always_2d=False)
        before_rms = float(np.sqrt(np.mean(np.asarray(before, dtype=np.float64) ** 2)) + 1e-12)
        manifest = conform_existing(voice_id, text, wav)
        for key in ("tts_input_text", "page_text", "seed_offset", "term_policy", "max_new_tokens_used"):
            if key in old:
                manifest[key] = old[key]
        audio, sr = sf.read(wav, always_2d=False)
        audio = np.asarray(audio, dtype=np.float32)
        manifest["prosody"] = prosody_check(
            audio, sr, voice["baseline"]["median_f0_hz"], config["quality"],
            not wav.name.endswith("-term.wav"),
        )
        manifest["timbre"] = (
            timbre_check(audio, sr, R / voice["reference_audio"], config["quality"])
            if not wav.name.startswith("dialogue-")
            else {"distance": None, "pass": True}
        )
        manifest = accept_best_timbre(manifest)
        mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        after_rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)) + 1e-12)
        delta = 20 * np.log10(after_rms / before_rms)
        if abs(delta) >= 0.5:
            changed.append((wav.name, round(delta, 1), text))
        print(f"[OK] {wav.name} {round(delta,1):+} dB  timbre={manifest['timbre']['distance']}", flush=True)
    print(f"reconform done: {sample}")
    if changed:
        print("音量有明显变化的条目：")
        for n, d, t in changed:
            print(f"  {n:<22}{d:+5.1f} dB  {t[:20]}")


if __name__ == "__main__":
    main()
