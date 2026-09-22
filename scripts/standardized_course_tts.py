# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "pykakasi"]
# ///
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel


import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "audio_voice_presets.json"


def load_config() -> dict:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


from ja_text import mora_count  # noqa: E402


def voice_for_role(config: dict, role: str) -> str:
    """按对话角色（A/B）取声线 id；role="card" 取词卡声线（config["card_voice"]）。
    全站规则（Luna 2026-09-23）：先发言者 = A，所以每课的 A/B 对应的性别可能不同，声线的 role 在配置里按课改。"""
    if role == "card":
        return config["card_voice"]
    for vid, voice in config["voices"].items():
        if voice.get("role") == role and not voice.get("candidate"):
            return vid
    raise KeyError(f"audio_voice_presets.json 里没有 role={role} 的正式声线")


def analyze_audio(path: Path, text: str, active_threshold_dbfs: float = -42.0) -> dict:
    audio, sr = sf.read(path, always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float64)
    peak = float(np.max(np.abs(audio))) or 1e-12
    frame = max(1, round(sr * 0.03))
    hop = max(1, round(sr * 0.01))
    rms_frames = []
    pitches = []
    min_lag, max_lag = round(sr / 350), round(sr / 70)
    for start in range(0, max(1, len(audio) - frame + 1), hop):
        chunk = audio[start : start + frame]
        if len(chunk) < frame:
            break
        rms = float(np.sqrt(np.mean(chunk * chunk) + 1e-12))
        db = 20 * np.log10(rms)
        rms_frames.append((rms, db))
        if db < active_threshold_dbfs:
            continue
        centered = chunk - np.mean(chunk)
        corr = np.correlate(centered, centered, mode="full")[frame - 1 :]
        search = corr[min_lag : max_lag + 1]
        if len(search) and corr[0] > 0:
            lag = int(np.argmax(search)) + min_lag
            if corr[lag] / corr[0] >= 0.32:
                pitches.append(sr / lag)
    active = [rms for rms, db in rms_frames if db >= active_threshold_dbfs]
    active_rms = float(np.sqrt(np.mean(np.square(active)))) if active else 1e-12
    syllables = mora_count(text)
    # 语速只按"有声部分"算：首尾补的静音不能计入，否则加长尾部静音会把语速判歪。语速单位是「秒/音拍」。
    idx = [i for i, (_rms, db) in enumerate(rms_frames) if db >= active_threshold_dbfs]
    speech_seconds = ((idx[-1] - idx[0]) * hop + frame) / sr if idx else len(audio) / sr
    return {
        "duration_seconds": round(len(audio) / sr, 4),
        "speech_seconds": round(speech_seconds, 4),
        "mora_count": syllables,
        "seconds_per_mora": round(speech_seconds / max(1, syllables), 4),
        "active_rms_dbfs": round(20 * np.log10(active_rms), 2),
        "peak_dbfs": round(20 * np.log10(peak), 2),
        "median_f0_hz": round(float(np.median(pitches)), 2) if pitches else None,
        "voiced_f0_p10_hz": round(float(np.percentile(pitches, 10)), 2) if pitches else None,
        "voiced_f0_p90_hz": round(float(np.percentile(pitches, 90)), 2) if pitches else None,
        "sample_rate_hz": sr,
        "channels": 1,
    }


def trim_and_pad(
    audio: np.ndarray,
    sr: int,
    leading_ms: int,
    trailing_ms: int,
    threshold_dbfs: float = -55.0,
    tail_keep_ms: int = 250,
    speech_end_dbfs: float = -48.0,
) -> np.ndarray:
    """裁掉首尾静音，但在末端保留 tail_keep_ms 的自然衰减 —— 句末的 요 收尾不能被切掉。"""
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    # 起点用较松的阈值（不切掉起音），终点用较严的阈值定位"人声真正结束的地方"，
    # 再往后只保留 tail_keep_ms 的自然衰减 —— 这样既不切收尾，也不把气音尾巴留下。
    lead = np.flatnonzero(np.abs(mono) >= 10 ** (threshold_dbfs / 20))
    speech = np.flatnonzero(np.abs(mono) >= 10 ** (speech_end_dbfs / 20))
    if len(lead) and len(speech):
        end = min(len(mono), int(speech[-1]) + 1 + round(sr * tail_keep_ms / 1000))
        mono = mono[int(lead[0]) : max(end, int(speech[-1]) + 1)]
    elif len(lead):
        mono = mono[int(lead[0]) : int(lead[-1]) + 1]
    leading = np.zeros(round(sr * leading_ms / 1000), dtype=mono.dtype)
    trailing = np.zeros(round(sr * trailing_ms / 1000), dtype=mono.dtype)
    return np.concatenate([leading, mono, trailing])


def normalize_active_rms(audio: np.ndarray, target_dbfs: float, threshold_dbfs: float) -> np.ndarray:
    threshold = 10 ** (threshold_dbfs / 20)
    active = audio[np.abs(audio) >= threshold]
    if not len(active):
        return audio
    current_dbfs = 20 * np.log10(np.sqrt(np.mean(active * active)) + 1e-12)
    gain_db = float(np.clip(target_dbfs - current_dbfs, -6.0, 6.0))
    normalized = audio * (10 ** (gain_db / 20))
    peak_limit = 10 ** (-1.0 / 20)
    peak = float(np.max(np.abs(normalized))) or 1.0
    return normalized * min(1.0, peak_limit / peak)


def conform_existing(voice_id: str, text: str, output: Path) -> dict:
    config = load_config()
    voice = config["voices"][voice_id]
    before = analyze_audio(output, text, config["quality"]["active_threshold_dbfs"])
    target_duration = mora_count(text) * voice["baseline"]["seconds_per_mora"]
    q = config["quality"]
    tempo = float(np.clip(before.get("speech_seconds", before["duration_seconds"]) / target_duration, q.get("tempo_min", 0.9), q.get("tempo_max", 1.12)))
    with tempfile.TemporaryDirectory(prefix="course-tts-") as temp_dir:
        stretched = Path(temp_dir) / "stretched.wav"
        subprocess.run(
            [
                "ffmpeg", "-v", "error", "-y", "-i", str(output),
                "-filter:a", f"atempo={tempo:.6f}", "-ar", "24000", "-ac", "1", str(stretched),
            ],
            check=True,
        )
        audio, sr = sf.read(stretched, always_2d=False)
    audio = trim_and_pad(
        np.asarray(audio), sr,
        config["output"]["leading_silence_ms"],
        config["output"]["trailing_silence_ms"],
        config["output"].get("trim_threshold_dbfs", -55.0),
        config["output"].get("tail_keep_ms", 250),
        config["output"].get("speech_end_threshold_dbfs", -48.0),
    )
    audio = normalize_active_rms(
        audio, voice["baseline"]["active_rms_dbfs"], config["quality"]["active_threshold_dbfs"]
    )
    sf.write(output, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")
    manifest = audit_output(voice_id, text, output)
    manifest["tempo_conformance"] = {
        "atempo_factor": round(tempo, 6),
        "pre_conformance_seconds_per_mora": before["seconds_per_mora"],
        "target_seconds_per_mora": voice["baseline"]["seconds_per_mora"],
    }
    output.with_suffix(".json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def assess(metrics: dict, baseline: dict, quality: dict) -> dict:
    is_short_term = metrics["mora_count"] <= 6
    pitch_low = baseline["voiced_f0_p10_hz"] * 0.9
    pitch_high = baseline["voiced_f0_p90_hz"] * 1.1
    checks = {
        "speed": bool(is_short_term or abs(metrics["seconds_per_mora"] / baseline["seconds_per_mora"] - 1)
        <= quality["duration_per_mora_tolerance_percent"] / 100),
        "pitch": bool(metrics["median_f0_hz"] is not None and pitch_low <= metrics["median_f0_hz"] <= pitch_high),
        "loudness": bool(abs(metrics["active_rms_dbfs"] - baseline["active_rms_dbfs"])
        <= (3.5 if is_short_term else quality["active_rms_tolerance_db"])),
        "peak": bool(metrics["peak_dbfs"] <= quality["peak_ceiling_dbfs"]),
    }
    return {
        "automatic_pass": all(checks.values()),
        "checks": checks,
        "short_term_rule": is_short_term,
        "manual_review": "required",
    }


def generation_kwargs(config: dict, variant: str = "default") -> dict:
    """variant="card" 时用更低的随机性，避免单词卡出现情绪漂移（低落、悲伤）。"""
    if variant == "card" and "generation_card" in config:
        return dict(config["generation_card"])
    return dict(config["generation"])


def tail_cliff_report(output: Path, is_clone: bool) -> dict | None:
    """只对 dialogue-*.wav 生效；返回 None 表示这条不参与句尾判定。"""
    if not output.name.startswith("dialogue"):
        return None
    try:
        from term_audio_policy import tail_cliff_check
    except Exception:
        return None
    audio, sr = sf.read(output, always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return tail_cliff_check(np.asarray(audio, dtype=np.float64), sr, is_clone)


def audit_output(voice_id: str, text: str, output: Path) -> dict:
    config = load_config()
    voice = config["voices"][voice_id]
    metrics = analyze_audio(output, text, config["quality"]["active_threshold_dbfs"])
    manifest = {
        "voice_id": voice_id,
        "text": text,
        "seed": voice["seed"],
        "model": voice["model"],
        "model_revision": voice["model_revision"],
        "reference_sha256": voice["reference_sha256"],
        "generation": generation_kwargs(config),
        "metrics": metrics,
        "quality_assessment": assess(metrics, voice["baseline"], config["quality"]),
        "output_sha256": sha256(output),
    }
    # 对话行加测「句尾悬崖」：模型有时会把最后一个音节直接吞掉（까/어/죠），
    # 而 ASR 会按上下文把它补回来，所以文本核对查不出，只能看收尾电平。
    tail = tail_cliff_report(output, voice["mode"] == "voice_clone")
    if tail is not None:
        manifest["metrics"]["tail_margin_db"] = tail["margin_db"]
        qa = manifest["quality_assessment"]
        qa["checks"]["tail"] = tail["pass"]
        qa["automatic_pass"] = all(qa["checks"].values())
    output.with_suffix(".json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


def generate(voice_id: str, text: str, output: Path) -> dict:
    config = load_config()
    voice = config["voices"][voice_id]
    reference = ROOT / voice["reference_audio"]
    if sha256(reference) != voice["reference_sha256"]:
        raise RuntimeError(f"Reference audio hash mismatch: {reference}")
    set_seed(voice["seed"])
    model_path = snapshot_download(
        voice["model"], revision=voice["model_revision"], local_files_only=True
    )
    model = Qwen3TTSModel.from_pretrained(str(model_path), device_map="cpu", dtype=torch.float32)
    kwargs = generation_kwargs(config)
    if voice["mode"] == "custom_voice":
        wavs, sr = model.generate_custom_voice(
            text=text,
            language=voice["language"],
            speaker=voice["speaker"],
            instruct=voice["instruct"],
            **kwargs,
        )
    else:
        prompt = model.create_voice_clone_prompt(
            ref_audio=str(reference),
            ref_text=voice["reference_text"],
            x_vector_only_mode=False,
        )
        wavs, sr = model.generate_voice_clone(
            text=text,
            language=voice["language"],
            voice_clone_prompt=prompt,
            **kwargs,
        )
    audio = trim_and_pad(
        np.asarray(wavs[0]),
        sr,
        config["output"]["leading_silence_ms"],
        config["output"]["trailing_silence_ms"],
    )
    audio = normalize_active_rms(
        audio,
        voice["baseline"]["active_rms_dbfs"],
        config["quality"]["active_threshold_dbfs"],
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    sf.write(output, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")
    return conform_existing(voice_id, text, output)


def main() -> None:
    parser = argparse.ArgumentParser(description="生成／检查商务日语课的两条标准声线。")
    sub = parser.add_subparsers(dest="command", required=True)
    analyze = sub.add_parser("analyze")
    analyze.add_argument("--voice", required=True)
    create = sub.add_parser("generate")
    create.add_argument("--voice", required=True)
    create.add_argument("--text", required=True)
    create.add_argument("--output", required=True, type=Path)
    audit = sub.add_parser("audit")
    audit.add_argument("--voice", required=True)
    audit.add_argument("--text", required=True)
    audit.add_argument("--output", required=True, type=Path)
    conform = sub.add_parser("conform")
    conform.add_argument("--voice", required=True)
    conform.add_argument("--text", required=True)
    conform.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    config = load_config()
    voice = config["voices"][args.voice]
    if args.command == "analyze":
        result = analyze_audio(ROOT / voice["reference_audio"], voice["reference_text"], config["quality"]["active_threshold_dbfs"])
    elif args.command == "generate":
        result = generate(args.voice, args.text, args.output if args.output.is_absolute() else ROOT / args.output)
    elif args.command == "audit":
        result = audit_output(args.voice, args.text, args.output if args.output.is_absolute() else ROOT / args.output)
    else:
        result = conform_existing(args.voice, args.text, args.output if args.output.is_absolute() else ROOT / args.output)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()


def instruct_for(voice: dict, filename: str) -> str:
    """单词卡（词、例句）用播音腔指示语 instruct_term，对话句用 instruct。"""
    if not filename.startswith("dialogue-") and voice.get("instruct_term"):
        return voice["instruct_term"]
    return voice["instruct"]
