# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "faster-whisper", "pykakasi"]
# ///
"""从根上解决对话句「最后一个字被砍掉」。

诊断（2026-09-18，Luna 第三次反馈仍听得出来之后重测）：
- 已上线的对话 wav，在收尾点之后是**整整 0.5 s 的数字零**（不是自然衰减到底噪），
  说明模型在 EOS 处硬停，末音节还没读完就结束了。这不是后处理裁掉的。
- 之前那道闸只看「最后一帧的电平」，于是放过了一类：最后一帧确实低到 -27 dB，
  但它是从 -4 dB **一帧（10 ms）之内**跌下去的。听感上就是被砍断。
  custom-09 d02（-4→-27）、d04（-10→-25）、custom-11 d06（-6→-22）都属于这类，
  全是 B。这解释了为什么上一轮「重录通过」之后 Luna 还是听得出来。

对策分两层：
1. **结构上不让目标句落在 EOS 上**：合成时在目标句后面接一句哨兵短句（默认「はい。」）。
   目标句因此变成「句中的一个完整句子」，模型会把它的末音节完整读完、带正常的句末语调，
   然后停顿，再读哨兵句。合成后找最后一段 ≥160 ms 的静音，从那里切断，丢掉哨兵。
   找不到停顿就判这次取样失败、换 seed 重来（绝不硬切，以免切进哨兵或切掉末音节）。
2. **闸门补上斜率**：tail_fade 量衰减过程中最大的单帧跌幅，超过 12 dB 判断崖。
   与原有的 tail_cliff（收尾电平）、check_sentence（整句 + 末两音节 ASR）一起把关。

读 audio-jobs/dialogue-tail-request.json：
  {"lessons": ["custom-09", ...], "roles": ["B"], "sentinel": "はい。"}
  roles 省略＝A/B 都做；lessons 里也可以写 {"lesson": ..., "file": ...} 精确指定。
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
    normalize_active_rms,
    voice_for_role,
    set_seed,
    trim_and_pad,
)
from breath_trim import strip_breath_both, strip_trailing_breath
from term_audio_policy import (
    check_sentence,
    prosody_check,
    tail_cliff_check,
    tail_fade,
    transcribe,
)

REQ = ROOT / "audio-jobs" / "dialogue-tail-request.json"
ATTEMPTS = 8
SENTINEL = "はい。"
MIN_GAP_MS = 160
KEEP_AFTER_MS = 140  # 目标句说完后保留的自然衰减



def audio_dir_for(lesson_id: str) -> Path:
    """课程音频所在目录（从课程 TS 里的音频路径推导）。"""
    for ts in (ROOT / "lib" / "lessons").glob("*.ts"):
        src = ts.read_text(encoding="utf-8")
        if not re.search(rf"^  id: '{re.escape(lesson_id)}',", src, re.M):
            continue
        m = re.search(r"/audio/standard/([^'`]*)dialogue-", src)
        if m:
            return ROOT / "public" / "audio" / "standard" / m.group(1).strip("/")
    return ROOT / "public" / "audio" / "standard" / lesson_id

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


def cut_before_sentinel(wav: np.ndarray, sr: int) -> np.ndarray | None:
    """在最后一段长静音处切断，丢掉哨兵句。找不到合格的停顿就返回 None。"""
    frame = max(1, int(sr * 0.01))
    levels = [
        float(np.sqrt(np.mean(np.square(wav[i : i + frame]))))
        for i in range(0, max(0, len(wav) - frame), frame)
    ]
    if not levels:
        return None
    peak = max(levels) or 1e-9
    loud = [v for v in levels if v > peak * 10 ** (-30 / 20)]
    if not loud:
        return None
    act = float(np.median(loud))
    floor = act * 10 ** (-35 / 20)
    voiced = [i for i, v in enumerate(levels) if v > floor]
    if len(voiced) < 2:
        return None
    need = MIN_GAP_MS // 10
    # 从后往前找最后一段 >=MIN_GAP_MS 的静音，且它前后都有人声（后面的就是哨兵）
    for k in range(len(voiced) - 1, 0, -1):
        gap = voiced[k] - voiced[k - 1] - 1
        if gap >= need:
            end_frame = voiced[k - 1] + 1 + KEEP_AFTER_MS // 10
            end = min(len(wav), end_frame * frame)
            return wav[:end]
    return None


def one_line(model, clone_prompt, voice_id, config, lesson, filename, text, sentinel) -> bool:
    voice = config["voices"][voice_id]
    is_clone = voice["mode"] != "custom_voice"
    path = audio_dir_for(lesson) / filename
    prompt_text = f"{text} {sentinel}"
    best = None
    for attempt in range(ATTEMPTS):
        set_seed(voice["seed"] + 400 + attempt)
        kwargs = generation_kwargs(config, "default")
        if is_clone:
            wavs, sr = model.generate_voice_clone(
                text=prompt_text,
                language=voice["language"],
                voice_clone_prompt=clone_prompt,
                **kwargs,
            )
        else:
            wavs, sr = model.generate_custom_voice(
                text=prompt_text,
                language=voice["language"],
                speaker=voice["speaker"],
                instruct=instruct_for(voice, filename),
                **kwargs,
            )
        raw = np.asarray(wavs[0], dtype=np.float64)
        cut = cut_before_sentinel(raw, sr)
        if cut is None:
            print(f"[SKIP] {lesson}/{filename} seed+{400 + attempt} 没找到哨兵前的停顿", flush=True)
            continue
        cut, _head, _dropped = strip_breath_both(cut, sr)
        audio = trim_and_pad(
            cut,
            sr,
            config["output"]["leading_silence_ms"],
            config["output"]["trailing_silence_ms"],
            config["output"].get("trim_threshold_dbfs", -55.0),
            config["output"].get("tail_keep_ms", 250),
            -90.0,  # 尾部已经按停顿切好，不要再按绝对阈值砍一刀
        )
        audio = normalize_active_rms(
            audio,
            voice["baseline"]["active_rms_dbfs"],
            config["quality"]["active_threshold_dbfs"],
        )
        sf.write(path, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")
        manifest = conform_existing(voice_id, text, path)
        final, fsr = sf.read(path, always_2d=False)
        final = np.asarray(final, dtype=np.float32)
        pros = prosody_check(final, fsr, voice["baseline"]["median_f0_hz"], config["quality"], True)
        cliff = tail_cliff_check(final, fsr, is_clone)
        fade = tail_fade(final, fsr)
        # ASR 必须转出**目标句**（不含哨兵）—— 既验证末音节没丢，也验证哨兵切干净了
        sent = check_sentence(transcribe(final, fsr), text)
        manifest["page_text"] = text
        manifest["prompt_text"] = prompt_text
        manifest["seed_offset"] = 400 + attempt
        manifest["tail_cliff"] = cliff
        manifest["tail_fade"] = fade
        manifest["sentence_asr"] = sent
        # 硬闸：句尾与文本完整度 —— 这次要解决的就是这个。
        # prosody 是软闸：B 声线系统性压低音高，把它算进硬闸会把 8 次重试全烧光，
        # 而且现网已上线的音频本来也没过 prosody，卡它只会拖慢不会更好。
        hard = (
            manifest["quality_assessment"]["automatic_pass"]
            and cliff["pass"]
            and fade["pass"]
            and sent["pass"]
        )
        ok = hard and pros["pass"]
        why = "" if ok else " <- " + ",".join(
            k for k, v in (
                ("quality", not manifest["quality_assessment"]["automatic_pass"]),
                ("prosody", not pros["pass"]),
                ("句尾电平", not cliff["pass"]),
                ("句尾断崖", not fade["pass"]),
                ("句首语气词", sent["lead_filler"]),
                ("整句不符", sent["ratio"] < 0.88),
                ("句尾不符", sent["tail_ratio"] < 0.80),
            ) if v
        )
        print(
            f"[{'PASS' if ok else 'CHECK'}] {lesson}/{filename} seed+{400 + attempt} "
            f"margin={cliff['margin_db']} step={fade['max_step_db']} "
            f"ratio={sent['ratio']} tail={sent['tail_ratio']}{why}",
            flush=True,
        )
        rank = (
            0 if ok else (1 if hard else 2),
            fade["max_step_db"] or 99,
            cliff["margin_db"] or 0,
            -sent["ratio"],
        )
        if best is None or rank < best[0]:
            best = (rank, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", final)
        if ok:
            break
        # 硬闸已经过了就不必再烧满 8 次；再试两次看有没有 prosody 也过的，然后收工。
        if best[0][0] <= 1 and attempt >= 3:
            break
    if best is None:
        return False
    sf.write(path, best[2], config["output"]["sample_rate_hz"], subtype="PCM_16")
    path.with_suffix(".json").write_text(best[1], encoding="utf-8")
    return best[0][0] == 0


def main() -> None:
    config = load_config()
    req = json.loads(REQ.read_text(encoding="utf-8"))
    sentinel = req.get("sentinel", SENTINEL)
    roles = set(req.get("roles") or ["A", "B"])
    items: list[tuple[str, str]] = []
    for entry in req.get("lessons", []):
        if isinstance(entry, dict):
            items.append((entry["lesson"], entry["file"]))
            continue
        for filename, (role, _text) in sorted(lesson_texts(entry).items()):
            if role in roles:
                items.append((entry, filename))
    models: dict[str, tuple] = {}
    results = []
    for lesson, filename in items:
        texts = lesson_texts(lesson)
        if filename not in texts:
            print(f"[MISS] {lesson}/{filename} 课文里找不到这句")
            continue
        role, text = texts[filename]
        voice_id = voice_for_role(config, role)
        if voice_id not in models:
            voice = config["voices"][voice_id]
            path = snapshot_download(
                voice["model"], revision=voice["model_revision"], local_files_only=True
            )
            model = Qwen3TTSModel.from_pretrained(path, device_map="cpu", dtype=torch.float32)
            prompt = None
            if voice["mode"] != "custom_voice":
                prompt = model.create_voice_clone_prompt(
                    ref_audio=str(ROOT / voice["reference_audio"]),
                    ref_text=voice["reference_text"],
                    x_vector_only_mode=False,
                )
            models[voice_id] = (model, prompt)
        model, prompt = models[voice_id]
        ok = one_line(model, prompt, voice_id, config, lesson, filename, text, sentinel)
        results.append((lesson, filename, role, ok))
    print("\n=== 哨兵重录结果 ===")
    for lesson, filename, role, ok in results:
        print(f"  {'✔' if ok else '✘'} {lesson}/{filename} ({role})")


if __name__ == "__main__":
    main()
