# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "pykakasi"]
# ///
"""声线样音：把 audio_voice_presets.json 里 candidates 的每条声线各生成几条样音，
放到 audio-jobs/voice-samples/<声线id>/，并写一个 index.html 让 Luna 直接用浏览器听着挑。

和正式流水线一样的做法：VoiceDesign 只用来「设计」出一段参考音（reference.wav），
之后的每条样音都用 Base 模型的 VoiceClone 从这段参考音克隆 —— 这样同一声线每句音色才一致，
选中之后直接把 reference.wav 当正式声线的 reference_audio 用，不必再设计一次。
Ono_Anna 是内置声线（CustomVoice），直接生成。

每条样音顺便量 median_f0 与 秒/音拍，写进 index.json —— 定声线后拿它当 baseline 的起点。
断点续作：已存在的 wav 不重做。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel

sys.path.insert(0, str(Path(__file__).resolve().parent))
from standardized_course_tts import (  # noqa: E402
    ROOT,
    analyze_audio,
    generation_kwargs,
    load_config,
    normalize_active_rms,
    set_seed,
    trim_and_pad,
)
from standardized_course_tts import instruct_for  # noqa: E402

OUT = ROOT / "audio-jobs" / "voice-samples"
BASE_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
TARGET_RMS = -22.0


def load(model_id: str):
    path = snapshot_download(model_id)  # 没缓存就下载
    return Qwen3TTSModel.from_pretrained(path, device_map="cpu", dtype=torch.float32), path


def finish(wav, sr, config, path: Path):
    audio = trim_and_pad(np.asarray(wav, dtype=np.float64), sr,
                         config["output"]["leading_silence_ms"], config["output"]["trailing_silence_ms"],
                         config["output"].get("trim_threshold_dbfs", -55.0), config["output"].get("tail_keep_ms", 250),
                         config["output"].get("speech_end_threshold_dbfs", -48.0))
    audio = normalize_active_rms(audio, TARGET_RMS, config["quality"]["active_threshold_dbfs"])
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")


def main() -> None:
    config = load_config()
    OUT.mkdir(parents=True, exist_ok=True)
    index = {"candidates": {}}
    models: dict[str, tuple] = {}
    for vid, voice in config["candidates"].items():
        vdir = OUT / vid
        texts = config["sample_texts"][voice["role"]]
        entry = {"label": voice["label"], "role": voice["role"], "mode": voice["mode"], "clips": []}
        set_seed(voice["seed"])
        kwargs = generation_kwargs(config, "card" if voice["role"] == "A" else "default")
        if voice["mode"] == "custom_voice":
            if voice["model"] not in models:
                models[voice["model"]] = load(voice["model"])
            model, _ = models[voice["model"]]
            for name, text in texts:
                path = vdir / f"{name}.wav"
                if not path.exists():
                    fname = "dialogue-x.wav" if name.startswith("dialogue") else f"{name}.wav"
                    wavs, sr = model.generate_custom_voice(text=text, language=voice["language"], speaker=voice["speaker"],
                                                           instruct=instruct_for(voice, fname), **kwargs)
                    finish(wavs[0], sr, config, path)
                entry["clips"].append({"file": f"{vid}/{name}.wav", "text": text, **analyze_audio(path, text)})
                print(f"[OK] {vid}/{name}", flush=True)
        else:
            ref = vdir / "reference.wav"
            if not ref.exists():
                if voice["model"] not in models:
                    models[voice["model"]] = load(voice["model"])
                design, dpath = models[voice["model"]]
                wavs, sr = design.generate_voice_design(text=voice["reference_text"], language=voice["language"],
                                                        instruct=voice["design_instruct"], **generation_kwargs(config))
                finish(wavs[0], sr, config, ref)
                print(f"[DESIGN] {vid}/reference.wav 由 {dpath} 生成", flush=True)
            entry["reference"] = {"file": f"{vid}/reference.wav", "text": voice["reference_text"], "design_instruct": voice["design_instruct"]}
            if BASE_MODEL not in models:
                models[BASE_MODEL] = load(BASE_MODEL)
            base, _ = models[BASE_MODEL]
            prompt = base.create_voice_clone_prompt(ref_audio=str(ref), ref_text=voice["reference_text"], x_vector_only_mode=False)
            for name, text in texts:
                path = vdir / f"{name}.wav"
                if not path.exists():
                    wavs, sr = base.generate_voice_clone(text=text, language=voice["language"], voice_clone_prompt=prompt, **kwargs)
                    finish(wavs[0], sr, config, path)
                entry["clips"].append({"file": f"{vid}/{name}.wav", "text": text, **analyze_audio(path, text)})
                print(f"[OK] {vid}/{name}", flush=True)
        index["candidates"][vid] = entry
        (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_html(index)
    print("样音全部生成完毕：", OUT / "index.html")


def write_html(index: dict) -> None:
    rows = []
    for vid, e in index["candidates"].items():
        clips = ""
        if e.get("reference"):
            clips += f'<li><b>设计参考音</b>（这一条是 VoiceDesign 直接生成的，其余都是从它克隆）<br><audio controls preload="none" src="{e["reference"]["file"]}"></audio><br><span class="t">{e["reference"]["text"]}</span></li>'
        for c in e["clips"]:
            f0 = c.get("median_f0_hz")
            clips += (f'<li><audio controls preload="none" src="{c["file"]}"></audio><br><span class="t">{c["text"]}</span>'
                      f'<span class="m">f0 {f0} Hz · {c["seconds_per_mora"]} 秒/拍 · {c["duration_seconds"]} s</span></li>')
        rows.append(f'<section><h2>{e["label"]}</h2><p class="id">{vid} · 角色 {e["role"]}</p><ul>{clips}</ul></section>')
    html = f"""<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>商务日语站 · 声线样音</title>
<style>body{{font-family:-apple-system,sans-serif;max-width:860px;margin:2rem auto;padding:0 1rem;line-height:1.5}}
section{{border:1px solid #ddd;border-radius:12px;padding:1rem 1.2rem;margin:1rem 0}}h2{{margin:.2rem 0}}.id{{color:#777;font-size:.85rem;margin:0 0 .6rem}}
ul{{list-style:none;padding:0}}li{{margin:.6rem 0;padding:.5rem;background:#f7f7f7;border-radius:8px}}.t{{display:block;margin-top:.2rem}}.m{{display:block;color:#888;font-size:.8rem}}</style>
<h1>声线样音（挑一条 A 女声读词卡、一条 B 男声读对话）</h1>
<p>A 组：词卡 + 例句，要的是播音腔、无情绪。B 组：对话句，要的是自然会话口气（最后一句是タメ口）。</p>
{''.join(rows)}</html>"""
    (OUT / "index.html").write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
