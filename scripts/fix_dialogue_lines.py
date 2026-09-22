# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "faster-whisper", "pykakasi"]
# ///
"""按新的句子闸门重录指定的对话句。

新增的两道闸（2026-09-18，起因见 term_audio_policy.py 的注释）：
  1. 句尾断崖检测 tail_cliff_check —— 自然收尾会一路衰减，被切断则停在接近说话音量处。
  2. 句子级 ASR 转写 check_sentence —— 整句相似度 + **句尾**相似度 + 句首语气词。
     句尾单独比对，是因为「少读最后一个音节」在整句相似度上只掉几个百分点，听感上却是话没说完。

声纹克隆的 B 整体收尾更抖，所以阈值更严、重试次数更多。

读 audio-jobs/dialogue-fix-request.json：
  {"items": [{"lesson": "custom-07", "file": "dialogue-04.wav"}, ...]}
课文原文从 lib/lessons/*.ts 里自动取，不用手写，避免抄错。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel

from standardized_course_tts import (
    ROOT,
    conform_existing,
    generation_kwargs,
    instruct_for,
    load_config,
    voice_for_role,
    set_seed,
    trim_and_pad,
)
from term_audio_policy import check_sentence, prosody_check, tail_cliff_check, transcribe

REQ = ROOT / "audio-jobs" / "dialogue-fix-request.json"
ATTEMPTS_CLONE = 8
ATTEMPTS_PLAIN = 6


def lesson_texts(lesson_id: str) -> dict[str, tuple[str, str]]:
    for ts in (ROOT / "lib" / "lessons").glob("*.ts"):
        src = ts.read_text(encoding="utf-8")
        if not re.search(rf"^  id: '{re.escape(lesson_id)}',", src, re.M):
            continue
        pairs = re.findall(r"role: '(A|B)',\n      text: '((?:[^'\\]|\\.)*)',", src)
        return {
            f"dialogue-{i:02d}.wav": (role, text.replace("\\'", "'"))
            for i, (role, text) in enumerate(pairs, start=1)
        }
    return {}


def load_model(voice: dict):
    path = snapshot_download(voice["model"], revision=voice["model_revision"], local_files_only=True)
    return Qwen3TTSModel.from_pretrained(path, device_map="cpu", dtype=torch.float32)


def regenerate(model, clone_prompt, voice_id, config, lesson, filename, text) -> bool:
    voice = config["voices"][voice_id]
    is_clone = voice["mode"] != "custom_voice"
    out = ROOT / "public" / "audio" / "standard" / lesson
    path = out / filename
    attempts = ATTEMPTS_CLONE if is_clone else ATTEMPTS_PLAIN
    best = None
    for attempt in range(attempts):
        set_seed(voice["seed"] + 200 + attempt)  # 和首轮生成错开，避免再抽到同一条
        kwargs = generation_kwargs(config, "default")
        if is_clone:
            wavs, sr = model.generate_voice_clone(
                text=text, language=voice["language"], voice_clone_prompt=clone_prompt, **kwargs
            )
        else:
            wavs, sr = model.generate_custom_voice(
                text=text,
                language=voice["language"],
                speaker=voice["speaker"],
                instruct=instruct_for(voice, filename),
                **kwargs,
            )
        audio = trim_and_pad(
            np.asarray(wavs[0]),
            sr,
            config["output"]["leading_silence_ms"],
            config["output"]["trailing_silence_ms"],
            config["output"].get("trim_threshold_dbfs", -55.0),
            config["output"].get("tail_keep_ms", 250),
        )
        sf.write(path, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")
        manifest = conform_existing(voice_id, text, path)
        final, fsr = sf.read(path, always_2d=False)
        final = np.asarray(final, dtype=np.float32)
        manifest["page_text"] = text
        manifest["seed_offset"] = 200 + attempt
        pros = prosody_check(final, fsr, voice["baseline"]["median_f0_hz"], config["quality"], True)
        cliff = tail_cliff_check(final, fsr, is_clone)
        sent = check_sentence(transcribe(final, fsr), text)
        manifest["prosody"] = pros
        manifest["tail_cliff"] = cliff
        manifest["sentence_asr"] = sent
        ok = manifest["quality_assessment"]["automatic_pass"] and pros["pass"] and cliff["pass"] and sent["pass"]
        why = "" if ok else " <- " + ",".join(
            k for k, v in (
                ("quality", not manifest["quality_assessment"]["automatic_pass"]),
                ("prosody", not pros["pass"]),
                ("句尾断崖", not cliff["pass"]),
                ("句首语气词", sent["lead_filler"]),
                ("整句不符", sent["ratio"] < 0.88),
                ("句尾不符", sent["tail_ratio"] < 0.80),
            ) if v
        )
        print(
            f"[{'PASS' if ok else 'CHECK'}] {lesson}/{filename} seed+{200 + attempt} "
            f"margin={cliff['margin_db']} ratio={sent['ratio']} tail={sent['tail_ratio']}{why}",
            flush=True,
        )
        # 排序：先看是否全过，再看句尾余量越负越好（衰减越充分），最后看整句相似度
        rank = (0 if ok else 1, cliff["margin_db"] or 0, -sent["ratio"])
        if best is None or rank < best[0]:
            best = (rank, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", final)
        if ok:
            break
    if best is not None:
        sf.write(path, best[2], config["output"]["sample_rate_hz"], subtype="PCM_16")
        path.with_suffix(".json").write_text(best[1], encoding="utf-8")
        return best[0][0] == 0
    return False


def main() -> None:
    items = json.loads(REQ.read_text(encoding="utf-8"))["items"]
    config = load_config()
    cache: dict[str, tuple] = {}
    results = []
    for item in items:
        lesson, filename = item["lesson"], item["file"]
        texts = lesson_texts(lesson)
        if filename not in texts:
            print(f"[SKIP] {lesson}/{filename} 在课程数据里找不到对应台词")
            continue
        role, text = texts[filename]
        voice_id = voice_for_role(config, role)
        if voice_id not in cache:
            voice = config["voices"][voice_id]
            model = load_model(voice)
            prompt = None
            if voice["mode"] != "custom_voice":
                prompt = model.create_voice_clone_prompt(
                    ref_audio=str(ROOT / voice["reference_audio"]),
                    ref_text=voice["reference_text"],
                    x_vector_only_mode=False,
                )
            cache[voice_id] = (model, prompt)
        model, prompt = cache[voice_id]
        ok = regenerate(model, prompt, voice_id, config, lesson, filename, text)
        results.append((lesson, filename, role, ok))
    print("\n=== 重录结果 ===")
    for lesson, filename, role, ok in results:
        print(f"  {'✔' if ok else '✘'} {lesson}/{filename} ({role})")


if __name__ == "__main__":
    main()
