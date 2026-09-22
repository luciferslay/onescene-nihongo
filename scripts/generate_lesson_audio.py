# /// script
# requires-python = ">=3.12"
# dependencies = ["qwen-tts==0.1.1", "soundfile", "numpy", "torch", "faster-whisper", "pykakasi"]
# ///
"""通用的课程音频生成脚本（日语版）：读 audio-jobs/lesson-audio-request.json {"lesson": "biz-01"}。

以前每做一课就复制一份 generate_custom_XX_audio_set.py，263 行里只有开头两个
A_JOBS / B_JOBS 字典不一样 —— 既容易抄错，也让「改一处闸门要改十份文件」。
这里改成从 lib/lessons/*.ts 自动抽取：
  对话按 role 分给 A / B；lessonWords → lesson-NN-term/example；bonusWords → word-NN-term/example。

**对话句一律走哨兵法**（2026-09-18 起，见 fix_dialogue_tails.py 的说明）：
合成时在目标句后面接一句「はい。」，让目标句不落在 EOS 上，末音节才会完整读完；
合成后在最后一段长停顿处切断丢掉哨兵。再加 tail_cliff（收尾电平）+ tail_fade（衰减斜率）
+ check_sentence（整句与末两音节 ASR）三道闸。单词卡沿用原来的时长/杂音/语气/音色四关。
"""
from __future__ import annotations

import json
import re
import sys

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
    load_config,
    normalize_active_rms,
    set_seed,
    trim_and_pad,
    instruct_for,
)
from term_audio_policy import (
    accept_best_timbre,
    check_sentence,
    finalize_term,
    prosody_check,
    tail_cliff_check,
    tail_fade,
    timbre_check,
    transcribe,
)
from fix_dialogue_tails import cut_before_sentinel
from breath_trim import strip_breath_both, strip_trailing_breath
from pause_check import allowed_pauses, internal_gaps

REQ = ROOT / "audio-jobs" / "lesson-audio-request.json"
def _pick_lesson() -> str:
    """要生成哪一课：优先看正在运行的 job 名。

    worker 在执行 <名字>.job 前会先建 <名字>.running；job 名若本身就是课程 id
    （如 biz-01.job），就用它。这样可以一次把好几课的 job 都放进队列，
    不必等上一课开跑后再去改那一份共用的 lesson-audio-request.json。
    job 名不是课程 id（如 biz-01-redo.job）时，退回读 request 文件。
    """
    running = sorted((ROOT / "audio-jobs").glob("*.running"))
    for marker in running:
        name = marker.stem
        if re.fullmatch(r"biz-\d{2}", name):
            return name
        job = marker.with_suffix(".job")
        if job.exists():
            m = re.search(r"^lesson\s*=\s*(biz-\d{2})", job.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1)
    return json.loads(REQ.read_text(encoding="utf-8"))["lesson"]


def _job_option(name: str) -> str | None:
    """读正在运行的 job 文件里「name=值」这一行。"""
    for marker in sorted((ROOT / "audio-jobs").glob("*.running")):
        job = marker.with_suffix(".job")
        if job.exists():
            m = re.search(rf"^{name}\s*=\s*(\S+)", job.read_text(encoding="utf-8"), re.M)
            if m:
                return m.group(1)
    return None


def _seed_base() -> int:
    """job 文件第二行可写 seed_offset=N：重录时换一批 seed。

    seed 是固定的，同一句重跑只会得到一模一样的几版（2026-09-20 custom-07 两条例句
    重跑后停顿位置分毫不差）。要换说法就得换 seed。"""
    for marker in sorted((ROOT / "audio-jobs").glob("*.running")):
        job = marker.with_suffix(".job")
        if job.exists():
            m = re.search(r"seed_offset\s*=\s*(\d+)", job.read_text(encoding="utf-8"))
            if m:
                return int(m.group(1))
    return 0


LESSON = _pick_lesson()
OUT = ROOT / "public" / "audio" / "standard" / LESSON
PROGRESS = OUT / f"{LESSON}-progress.json"
TERM_ATTEMPTS = 6
DIALOGUE_ATTEMPTS = 8
SENTINEL = "はい。"
SHORT_TERM_SUFFIX = "。"


def _unesc(text: str) -> str:
    return text.replace("\\'", "'")


def collect_jobs() -> tuple[dict[str, str], dict[str, str]]:
    """从课程 TS 里抽出所有要生成的文本。单词卡全部走 A 声线。"""
    for ts in (ROOT / "lib" / "lessons").glob("*.ts"):
        text = ts.read_text(encoding="utf-8")
        if not re.search(rf"^  id: '{re.escape(LESSON)}',", text, re.M):
            continue
        a: dict[str, str] = {}
        b: dict[str, str] = {}
        pairs = re.findall(r"role: '(A|B)',\n      text: '((?:[^'\\]|\\.)*)',", text)
        for i, (role, line) in enumerate(pairs, start=1):
            (a if role == "A" else b)[f"dialogue-{i:02d}.wav"] = _unesc(line)
        for key, prefix in (("lessonWords", "lesson"), ("bonusWords", "word")):
            block = re.search(rf"  {key}: \[(.*?)\n  \],", text, re.S)
            if not block:
                continue
            items = re.findall(
                r"ja: '((?:[^'\\]|\\.)*)',\n      zh: '(?:[^'\\]|\\.)*',\n      example: '((?:[^'\\]|\\.)*)',",
                block.group(1),
            )
            for i, (ja, example) in enumerate(items, start=1):
                a[f"{prefix}-{i:02d}-term.wav"] = _unesc(ja)
                a[f"{prefix}-{i:02d}-example.wav"] = _unesc(example)
        return a, b
    raise SystemExit(f"课程 {LESSON} 在 lib/lessons 里找不到")


A_JOBS, B_JOBS = collect_jobs()
SEED_BASE = _seed_base()
# match_prosody=1：Luna 标了「3 语气不自然」时用。以同课其他同类音频（词/例句/对话同声线）的
# 基频中位数为目标，句尾走势以 1.0（不上扬不下坠）为目标，挑最接近的一版；抽满所有 seed 再挑。
MATCH_PROSODY = _job_option("match_prosody") == "1"


def _baselines() -> dict[str, float]:
    """在开始生成前算一次：只用进度文件里已完成（= 不在这次重录范围内）的同课音频。"""
    try:
        done = set(json.loads((OUT / f"{LESSON}-progress.json").read_text(encoding="utf-8"))["completed"])
    except Exception:
        return {}
    out = {}
    for kind in ("-term", "-example"):
        vals = []
        for name in done:
            if not name.endswith(f"{kind}.wav"):
                continue
            try:
                m = json.loads((OUT / name).with_suffix(".json").read_text(encoding="utf-8"))
                vals.append(float(m["prosody"]["median_f0"]))
            except Exception:
                pass
        if vals:
            out[kind] = float(np.median(vals))
    # 对话句按声线分：用**全站**已完成的同声线对话句（一课只有两三句同声线，样本太少会带偏；
    # 2026-09-22 custom-16 的 A 声线只剩一句慢速句做基准，差点把语速往慢里拉）
    for mf in (OUT.parent).glob("biz-*/dialogue-*.json"):
        if mf.parent == OUT and mf.with_suffix(".wav").name not in done:
            continue
        try:
            m = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            continue
        vid = m.get("voice_id")
        try:
            f0, rate = float(m["prosody"]["median_f0"]), float(m["metrics"]["seconds_per_mora"])
        except (KeyError, TypeError, ValueError):
            continue
        out.setdefault(f"f0:{vid}", []).append(f0)
        out.setdefault(f"rate:{vid}", []).append(rate)
    for k in [k for k in out if isinstance(out[k], list)]:
        out[k] = float(np.median(out[k]))
    return out


F0_BASE = _baselines() if MATCH_PROSODY else {}


# 例句里超过这么长的无标点停顿算不自然
PAUSE_GATE_MS = 300
# 载体短语（见 fix_term_carrier.py）
CARRIER = "と言います。"


def tts_text(filename: str, text: str) -> str:
    if filename.endswith("-term.wav") and not text.endswith(SHORT_TERM_SUFFIX):
        return text + SHORT_TERM_SUFFIX
    if filename.startswith("dialogue-"):
        return f"{text} {SENTINEL}"
    return text


def save_progress(completed: list[str]) -> None:
    PROGRESS.write_text(
        json.dumps(
            {"completed": sorted(set(completed)), "total": len(A_JOBS) + len(B_JOBS)},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def load_model(voice: dict):
    model_path = snapshot_download(voice["model"], revision=voice["model_revision"], local_files_only=True)
    return Qwen3TTSModel.from_pretrained(model_path, device_map="cpu", dtype=torch.float32)


def generate_one(model, voice_id: str, filename: str, text: str, config: dict, clone_prompt=None) -> None:
    """生成一条音频。所有条目都会做多 seed 重试：时长/杂音（term）、自动质检、播音腔语气三关都过才收。"""
    voice = config["voices"][voice_id]
    spoken = tts_text(filename, text)
    is_term = filename.endswith("-term.wav")
    is_card = not filename.startswith("dialogue-")
    syl = max(1, mora_count(text))
    path = OUT / filename
    attempts = TERM_ATTEMPTS if is_card else DIALOGUE_ATTEMPTS
    if MATCH_PROSODY:
        attempts *= 2  # 要挑语气最接近的一版，多抽几次
    best = None  # (rank, manifest_text, audio)
    for attempt in range(attempts):
        set_seed(voice["seed"] + SEED_BASE + attempt)
        kwargs = generation_kwargs(config, "card" if is_card else "default")
        if is_term:
            kwargs["max_new_tokens"] = min(kwargs["max_new_tokens"], 12 + 8 * syl)
        if voice["mode"] == "custom_voice":
            wavs, sr = model.generate_custom_voice(
                text=spoken,
                language=voice["language"],
                speaker=voice["speaker"],
                instruct=instruct_for(voice, filename),
                **kwargs,
            )
        else:
            wavs, sr = model.generate_voice_clone(
                text=spoken,
                language=voice["language"],
                voice_clone_prompt=clone_prompt,
                **kwargs,
            )
        raw = np.asarray(wavs[0])
        term_info = None
        if is_term:
            raw, term_info = finalize_term(raw, sr, syl, text)
        if not is_card:
            # 哨兵法：目标句后面接了一句「はい。」，在最后一段长停顿处切断把它丢掉。
            # 切不出停顿说明这次取样把两句黏在一起了，直接换 seed 重来，绝不硬切。
            cut = cut_before_sentinel(np.asarray(raw, dtype=np.float64), sr)
            if cut is None:
                print(f"[SKIP] {filename} seed+{attempt} 没找到哨兵前的停顿", flush=True)
                continue
            raw = cut
            # 句子说完、哨兵「はい」之前偶尔会夹一声叹气或吸气 —— 切掉（2026-09-20 custom-16 d03）
            raw, head_cut, dropped = strip_breath_both(raw, sr)
            if head_cut or dropped:
                print(f"[BREATH] {filename} seed+{attempt} 切掉句首 {head_cut:.2f}s / 句末 {dropped:.2f}s 气声杂音", flush=True)
        audio = trim_and_pad(
            raw,
            sr,
            config["output"]["leading_silence_ms"],
            config["output"]["trailing_silence_ms"],
            config["output"].get("trim_threshold_dbfs", -55.0),
            config["output"].get("tail_keep_ms", 120),
            # 对话句尾部已按停顿切好，不要再按绝对阈值砍一刀（那正是句尾被削的原因之一）
            config["output"].get("speech_end_threshold_dbfs", -48.0) if is_card else -90.0,
        )
        if not is_card:
            audio = normalize_active_rms(
                audio,
                config["voices"][voice_id]["baseline"]["active_rms_dbfs"],
                config["quality"]["active_threshold_dbfs"],
            )
        sf.write(path, audio, config["output"]["sample_rate_hz"], subtype="PCM_16")
        manifest = conform_existing(voice_id, text, path)
        # conform_existing 会把变速与音量归一的结果写回文件，必须把这一版读回来，
        # 否则最后挑中候选时又会用归一前的音频覆盖掉（音量忽大忽小、语速也没对齐）。
        conformed, _csr = sf.read(path, always_2d=False)
        audio = np.asarray(conformed)
        manifest["tts_input_text"] = spoken
        manifest["page_text"] = text
        manifest["seed_offset"] = SEED_BASE + attempt
        term_ok = True
        if term_info is not None:
            manifest["term_policy"] = term_info
            term_ok = term_info["pass"]
        final_audio, _sr = sf.read(path, always_2d=False)
        pros = prosody_check(
            np.asarray(final_audio, dtype=np.float32),
            config["output"]["sample_rate_hz"],
            voice["baseline"]["median_f0_hz"],
            config["quality"],
            not is_term,
        )
        manifest["prosody"] = pros
        timb = (
            timbre_check(
                np.asarray(final_audio, dtype=np.float32),
                config["output"]["sample_rate_hz"],
                ROOT / voice["reference_audio"],
                config["quality"],
            )
            if is_card
            else {"distance": None, "pass": True}
        )
        manifest["timbre"] = timb
        cliff = fade = sent = None
        tail_ok = True
        if not is_card:
            arr = np.asarray(final_audio, dtype=np.float32)
            cliff = tail_cliff_check(arr, config["output"]["sample_rate_hz"], voice["mode"] != "custom_voice")
            fade = tail_fade(arr, config["output"]["sample_rate_hz"])
            sent = check_sentence(transcribe(arr, config["output"]["sample_rate_hz"]), text)
            manifest["tail_cliff"] = cliff
            manifest["tail_fade"] = fade
            manifest["sentence_asr"] = sent
            tail_ok = cliff["pass"] and fade["pass"] and sent["pass"]
        # 例句：没有标点的地方不该断开（2026-09-20 custom-17「올라오자마자」中间断了 370ms）
        pause_ok, max_gap = True, 0
        if (is_card and not is_term) or (MATCH_PROSODY and not is_card):
            gaps = internal_gaps(np.asarray(final_audio, dtype=np.float64),
                                 config["output"]["sample_rate_hz"], PAUSE_GATE_MS)
            max_gap = max((ms for _, ms in gaps), default=0)
            pause_ok = len(gaps) <= allowed_pauses(text)
            manifest["internal_pause"] = {"gaps_ms": [int(ms) for _, ms in gaps], "pass": pause_ok}
        tempo = abs(manifest.get("tempo_conformance", {}).get("atempo_factor", 1.0) - 1.0)
        manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
        ok = (manifest["quality_assessment"]["automatic_pass"] and term_ok
              and pros["pass"] and timb["pass"] and tail_ok and pause_ok)
        dur = manifest["metrics"]["duration_seconds"]
        why = "" if ok else " <- " + ",".join(
            k for k, v in (("quality", not manifest["quality_assessment"]["automatic_pass"]),
                           ("term", not term_ok), ("low_pitch", pros["low_pitch"]),
                           ("falling_tail", pros["falling_tail"]), ("timbre", not timb["pass"]),
                           ("句尾电平", cliff is not None and not cliff["pass"]),
                           ("句尾断崖", fade is not None and not fade["pass"]),
                           ("句子ASR", sent is not None and not sent["pass"]),
                           ("句中停顿", not pause_ok)) if v
        )
        print(f"[{'PASS' if ok else 'CHECK'}] {voice_id}: {filename} ({dur}s, seed+{attempt}, "
              f"f0={pros['median_f0']}/{pros['baseline_f0']}, tail={pros['tail_vs_median']}, "
              f"timbre={timb['distance']}){why}", flush=True)
        # 排序：先看是否全过，再看变速幅度（越接近 1 越自然），最后看句末下坠越小越好
        # 排序：先看是否全过，再看音色离参考多近，然后变速幅度，最后句末下坠
        if MATCH_PROSODY and is_card:
            base = F0_BASE.get("-term" if is_term else "-example")
            dist = (abs(pros["median_f0"] / base - 1) if base else 0) + abs(pros["tail_vs_median"] - 1)
            rank = (0 if (ok or dist < 0.12) else 1, round(dist, 3), round(timb["distance"] or 0, 3))
            print(f"    [PROSODY] 目标 f0≈{base and round(base, 1)}，本版偏差 {dist:.3f}", flush=True)
        elif MATCH_PROSODY:
            # 对话句（Luna 标了语气 / 语速 / 连读问题）：句尾与 ASR 必须过，其次句中停顿，
            # 再比基频和语速离同课同声线对话句有多远
            fb, rb = F0_BASE.get(f"f0:{voice_id}"), F0_BASE.get(f"rate:{voice_id}")
            dist = ((abs(pros["median_f0"] / fb - 1) if fb else 0)
                    + (abs(manifest["metrics"]["seconds_per_mora"] / rb - 1) if rb else 0))
            rank = (0 if tail_ok else 1, 0 if pause_ok else 1, round(dist, 3), fade["max_step_db"] or 99)
            print(f"    [PROSODY] 目标 f0≈{fb and round(fb, 1)} 秒/音拍≈{rb and round(rb, 3)}，本版偏差 {dist:.3f}"
                  f"，句中停顿 {max_gap}ms", flush=True)
        elif is_card:
            rank = (0 if ok else 1, 0 if pause_ok else 1, max_gap // 100,
                    round(timb["distance"] or 0, 3), round(tempo, 3), -pros["tail_vs_median"])
        else:
            # 对话句先看是否全过，再看衰减斜率（越小越自然），然后收尾电平
            rank = (0 if ok else (1 if tail_ok else 2), fade["max_step_db"] or 99,
                    cliff["margin_db"] or 0, round(tempo, 3))
        if best is None or rank < best[0]:
            best = (rank, manifest_text, audio)
        if ok and not MATCH_PROSODY:
            break
    if best is not None:
        sf.write(path, best[2], config["output"]["sample_rate_hz"], subtype="PCM_16")
        final = accept_best_timbre(json.loads(best[1]))
        path.with_suffix(".json").write_text(
            json.dumps(final, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        # 单词本身（-term）抽满 seed 还没过，就改用「载体短语」再救一次：
        # 把词放进「<词>、と言います。」的最前面再从停顿处切下来。
        # 短词只有一两个音节时模型容易读飘、也容易撞 EOS，给它后续上下文就稳得多
        # （起因是 Luna 听出 custom-12 的 내내 不自然，2026-09-18）。
        if is_term and best[0][0] != 0:
            try:
                from fix_term_carrier import one_term

                print(f"[CARRIER] {filename} 改用载体短语再试", flush=True)
                one_term(model, voice_id, config, OUT.name, filename, text, CARRIER)
            except Exception as exc:  # 救援失败就保留原来的最优取样，不影响整课
                print(f"[CARRIER] {filename} 载体短语失败：{exc}", flush=True)


def run_voice(voice_id: str, jobs: dict[str, str], completed: list[str], config: dict) -> None:
    pending = [(name, text) for name, text in jobs.items() if name not in completed]
    if not pending:
        return
    voice = config["voices"][voice_id]
    model = load_model(voice)
    clone_prompt = None
    if voice["mode"] != "custom_voice":
        clone_prompt = model.create_voice_clone_prompt(
            ref_audio=str(ROOT / voice["reference_audio"]),
            ref_text=voice["reference_text"],
            x_vector_only_mode=False,
        )
    for filename, text in pending:
        generate_one(model, voice_id, filename, text, config, clone_prompt)
        completed.append(filename)
        save_progress(completed)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    config = load_config()
    completed: list[str] = []
    if PROGRESS.exists():
        completed = json.loads(PROGRESS.read_text(encoding="utf-8")).get("completed", [])
    # job 文件里写 redo=a.wav,b.wav：开跑前先把这几条从「已完成」里拿掉，免得要手动改进度文件
    redo = _job_option("redo")
    if redo:
        drop = {x.strip() for x in redo.split(",") if x.strip()}
        completed = [x for x in completed if x not in drop]
        print(f"[REDO] 重录 {sorted(drop)}", flush=True)
    run_voice(voice_for_role(config, "A"), A_JOBS, completed, config)
    run_voice(voice_for_role(config, "B"), B_JOBS, completed, config)
    failed = []
    for filename in (*A_JOBS, *B_JOBS):
        manifest_path = (OUT / filename).with_suffix(".json")
        if not manifest_path.exists():
            failed.append(filename)
            continue
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if (not manifest["quality_assessment"]["automatic_pass"]
                or not manifest.get("term_policy", {"pass": True})["pass"]
                or not manifest.get("prosody", {"pass": True})["pass"]
                or not manifest.get("timbre", {"pass": True})["pass"]):
            failed.append(filename)
    save_progress(completed)
    print(f"all complete: {len(completed)}/{len(A_JOBS) + len(B_JOBS)}")
    if failed:
        print("automatic check failed (regenerate or review manually): " + ", ".join(failed))


if __name__ == "__main__":
    main()
