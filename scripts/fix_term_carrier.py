# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "faster-whisper", "pykakasi"]
# ///
"""用「载体短语」重录单词卡，专治两三音节的短词。

起因（Luna 2026-09-18 听感反馈）：custom-12 的 `내내` 读得不自然。
短词是单词卡里最难的一类 —— 模型只有一两个音节的上下文，容易读飘；
音色比对也因为采样太短而天然吃亏（custom-09 的 챙겨 주다、custom-11 的 입을 삐죽이다
都卡在同一关）。

Luna 的思路是「从例句里精准截出这个词」。实测发现在**现有例句上做不到**：
`주말 내내 집에만 있었어요.` 整句 2.0 秒是一段连续声音，词与词之间**一个停顿都没有**，
没法靠静音检测切；而且 `주말 내내` 会发生流音化（ㄹ+ㄴ → ㄹㄹ），
实际读作 [주말래내]，硬切出来开头是「래」而不是「내」。

所以改成她这个思路的可控版本：**自己造一个专门用来切的载体短语**
    「<词>、と言います。」（日语版；韩语版是「내내, 이렇게 말합니다.」）
目标词放在最前面、后面跟一个逗号停顿。这样
  - 模型有后续上下文，不会把短词读飘、也不会撞在 EOS 上；
  - 目标词自己就是一个完整的语调单位（不像从句中硬切那样缺头少尾）；
  - 逗号会生成明显停顿，切点干净且可验证。
切完用 ASR 确认转写就是这个词本身（哨兵没混进来、也没少读）。

读 audio-jobs/term-carrier-request.json：
  {"items": [{"lesson": "custom-12", "file": "lesson-03-term.wav"}], "carrier": "と言います。"}
"""
from __future__ import annotations

import json
import re

import numpy as np
import soundfile as sf
import torch
from huggingface_hub import snapshot_download
from qwen_tts import Qwen3TTSModel

from standardized_course_tts import (
    ROOT,
    conform_existing,
    generation_kwargs,
    mora_count,
    voice_for_role,
    instruct_for,
    load_config,
    normalize_active_rms,
    set_seed,
    trim_and_pad,
)
from term_audio_policy import (
    accept_best_timbre,
    check_one,
    finalize_term,
    prosody_check,
    timbre_check,
    transcribe,
)

REQ = ROOT / "audio-jobs" / "term-carrier-request.json"


def _req_path():
    """job 文件第二行可写 request=<文件名>：几个载体任务可以同时排队，各读各的清单。"""
    for marker in sorted((ROOT / "audio-jobs").glob("*.running")):
        job = marker.with_suffix(".job")
        if job.exists():
            mm = re.search(r"^request\s*=\s*(\S+)", job.read_text(encoding="utf-8"), re.M)
            if mm:
                return ROOT / "audio-jobs" / mm.group(1)
    return REQ
CARRIER = "と言います。"
ATTEMPTS = 8
MIN_GAP_MS = 120
KEEP_AFTER_MS = 120


def audio_dir_for(lesson_id: str):
    for ts in (ROOT / "lib" / "lessons").glob("*.ts"):
        src = ts.read_text(encoding="utf-8")
        if not re.search(rf"^  id: '{re.escape(lesson_id)}',", src, re.M):
            continue
        m = re.search(r"/audio/standard/([^'`]*)dialogue-", src)
        if m:
            return ROOT / "public" / "audio" / "standard" / m.group(1).strip("/")
    return ROOT / "public" / "audio" / "standard" / lesson_id


def term_text(lesson_id: str, filename: str) -> str | None:
    """从课程 TS 里取出这个词卡对应的词。lesson-NN → lessonWords，word-NN → bonusWords。"""
    kind, idx = filename.split("-")[0], int(filename.split("-")[1])
    key = "lessonWords" if kind == "lesson" else "bonusWords"
    for ts in (ROOT / "lib" / "lessons").glob("*.ts"):
        src = ts.read_text(encoding="utf-8")
        if not re.search(rf"^  id: '{re.escape(lesson_id)}',", src, re.M):
            continue
        block = re.search(rf"  {key}: \[(.*?)\n  \],", src, re.S)
        if not block:
            return None
        items = re.findall(r"ja: '((?:[^'\\]|\\.)*)',", block.group(1))
        return items[idx - 1].replace("\\'", "'") if idx <= len(items) else None
    return None


def cut_at_first_pause(wav: np.ndarray, sr: int) -> np.ndarray | None:
    """切下载体短语最前面那个词。找第一段 >=MIN_GAP_MS 的静音，在它前面收尾。"""
    frame = max(1, int(sr * 0.01))
    lv = [
        float(np.sqrt(np.mean(np.square(wav[i : i + frame]))))
        for i in range(0, max(0, len(wav) - frame), frame)
    ]
    if not lv:
        return None
    peak = max(lv) or 1e-9
    loud = [v for v in lv if v > peak * 10 ** (-30 / 20)]
    if not loud:
        return None
    act = float(np.median(loud))
    floor = act * 10 ** (-35 / 20)
    voiced = [i for i, v in enumerate(lv) if v > floor]
    if len(voiced) < 2:
        return None
    need = MIN_GAP_MS // 10
    for k in range(1, len(voiced)):
        if voiced[k] - voiced[k - 1] - 1 >= need:
            end = min(len(wav), (voiced[k - 1] + 1 + KEEP_AFTER_MS // 10) * frame)
            return wav[:end]
    return None


def one_term(model, voice_id, config, lesson, filename, text, carrier, original_rejected=False) -> bool:
    """original_rejected=True：Luna 人耳否决了原版（如 2026-09-21 custom-21 쫄깃하다 拖长音），
    这时只要载体版 ASR 读对就换，不再拿音色和原版比。"""
    voice = config["voices"][voice_id]
    path = audio_dir_for(lesson) / filename
    from ja_text import tts_reading

    prompt_text = f"{tts_reading(text)}、{carrier}"
    syl = max(1, mora_count(text))
    best = None
    # 先把现有文件原样存起来：下面每次尝试都会覆盖 path，
    # 载体版如果不比原版好，最后要原封不动地还回去（2026-09-19 的教训：
    # 兜底曾把 custom-14 的 다육이/새싹/그늘 换成了更差的版本）。
    orig_wav = path.read_bytes() if path.exists() else None
    orig_json_path = path.with_suffix(".json")
    orig_json = orig_json_path.read_text(encoding="utf-8") if orig_json_path.exists() else None
    orig_timbre = None
    if orig_json:
        try:
            orig_timbre = json.loads(orig_json).get("timbre", {}).get("distance")
        except Exception:
            orig_timbre = None
    for attempt in range(ATTEMPTS):
        set_seed(voice["seed"] + 600 + attempt)
        kwargs = generation_kwargs(config, "card")
        wavs, sr = model.generate_custom_voice(
            text=prompt_text,
            language=voice["language"],
            speaker=voice["speaker"],
            instruct=instruct_for(voice, filename),
            **kwargs,
        )
        cut = cut_at_first_pause(np.asarray(wavs[0], dtype=np.float64), sr)
        if cut is None:
            print(f"[SKIP] {lesson}/{filename} seed+{600 + attempt} 载体短语没读出停顿", flush=True)
            continue
        raw, term_info = finalize_term(cut, sr, syl, text)
        audio = trim_and_pad(
            raw,
            sr,
            config["output"]["leading_silence_ms"],
            config["output"]["trailing_silence_ms"],
            config["output"].get("trim_threshold_dbfs", -55.0),
            config["output"].get("tail_keep_ms", 120),
            -90.0,
        )
        audio = normalize_active_rms(
            audio,
            voice["baseline"]["active_rms_dbfs"],
            config["quality"]["active_threshold_dbfs"],
        )
        sf.write(path, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")
        manifest = conform_existing(voice_id, text, path)
        final, fsr = sf.read(path, always_2d=False)
        arr = np.asarray(final, dtype=np.float32)
        pros = prosody_check(arr, fsr, voice["baseline"]["median_f0_hz"], config["quality"], False)
        timb = timbre_check(arr, fsr, ROOT / voice["reference_audio"], config["quality"])
        texts = transcribe(arr, fsr)
        asr = check_one(texts.get("medium") or texts.get("small", ""), text)
        manifest["term_policy"] = term_info
        manifest["prosody"] = pros
        manifest["timbre"] = timb
        manifest["carrier_text"] = prompt_text
        manifest["carrier_asr"] = {"transcripts": texts, "check": asr}
        manifest["seed_offset"] = 600 + attempt
        hard = term_info["pass"] and asr["pass"] and manifest["quality_assessment"]["automatic_pass"]
        ok = hard and pros["pass"] and timb["pass"]
        why = "" if ok else " <- " + ",".join(
            k for k, v in (
                ("term", not term_info["pass"]),
                ("asr", not asr["pass"]),
                ("quality", not manifest["quality_assessment"]["automatic_pass"]),
                ("prosody", not pros["pass"]),
                ("timbre", not timb["pass"]),
            ) if v
        )
        print(
            f"[{'PASS' if ok else 'CHECK'}] {lesson}/{filename} seed+{600 + attempt} "
            f"{manifest['metrics']['duration_seconds']}s timbre={timb['distance']} "
            f"asr={texts.get('medium')!r}{why}",
            flush=True,
        )
        rank = (0 if ok else (1 if hard else 2), round(timb["distance"] or 0, 3))
        if best is None or rank < best[0]:
            best = (rank, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", arr)
        if ok:
            break
    # 只有「全过」或者「ASR 对 + 音色比原版近」才换；否则把原版还回去。
    better = best is not None and (
        best[0][0] == 0
        or (
            json.loads(best[1])["carrier_asr"]["check"]["pass"]
            and (original_rejected or (orig_timbre is not None and best[0][1] < orig_timbre))
        )
    )
    if not better:
        if orig_wav is not None:
            path.write_bytes(orig_wav)
        if orig_json is not None:
            orig_json_path.write_text(orig_json, encoding="utf-8")
        print(f"[KEEP] {lesson}/{filename} 载体版不比原版好，保留原版（原音色 {orig_timbre}）", flush=True)
        return False
    sf.write(path, best[2], config["output"]["sample_rate_hz"], subtype="PCM_16")
    path.with_suffix(".json").write_text(
        json.dumps(accept_best_timbre(json.loads(best[1])), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return best[0][0] == 0


def main() -> None:
    config = load_config()
    req = json.loads(_req_path().read_text(encoding="utf-8"))
    carrier = req.get("carrier", CARRIER)
    voice_id = voice_for_role(config, "card")
    voice = config["voices"][voice_id]
    model = Qwen3TTSModel.from_pretrained(
        snapshot_download(voice["model"], revision=voice["model_revision"], local_files_only=True),
        device_map="cpu",
        dtype=torch.float32,
    )
    results = []
    for item in req["items"]:
        text = term_text(item["lesson"], item["file"])
        if not text:
            print(f"[MISS] {item['lesson']}/{item['file']} 找不到对应的词")
            continue
        ok = one_term(model, voice_id, config, item["lesson"], item["file"], text, carrier,
                      item.get("original_rejected", False))
        results.append((item["lesson"], item["file"], text, ok))
    print("\n=== 载体短语重录结果 ===")
    for lesson, filename, text, ok in results:
        print(f"  {'✔' if ok else '✘'} {lesson}/{filename}  {text}")


if __name__ == "__main__":
    main()
