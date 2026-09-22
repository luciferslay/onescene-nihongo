"""单词朗读（*-term.wav）统一生成准则 v2（2026-09-13 起，所有课程通用）—— 日语版。

日语版改动（2026-09-22）：音节一律换成音拍（mora，见 ja_text.py）；时长门限按日语重标（下面的常量，
声线定下来后要用样音再校一次）；ASR 用 whisper 的日语（language="ja"）；转写比对前把汉字假名混写
统一转成平假名读音再比（_kana_only），拆浊点（decompose）代替韩语的拆字母（_jamo）。

背景（用户三轮人耳复核暴露的问题）：
- 过长：模型偶尔在单词后先静音、再吐出多余杂音（도시락 8.4 s、크로스핏 24.8 s）。
- 过短：粗暴地按“首段语音后”截断会把词内的自然停顿当成结尾（별도 只读了一半）。
- 杂音：ASR 复核发现，用户听到的“杂音”其实多是词前多出来的语气词——
  스모크 → “오! 스모크”，세라믹 → “어, 세라믹”，무안하다 → “아.. 무안하다”，설립하다 → “어, 설립하다”。
  这种缺陷靠时长和频谱都测不出来，只有把音频转写出来才能发现。

准则：
1. 时长（以去掉首尾静音的“有效语音时长”为准，原始生成、未做语速校准前）：
   下限 每音节 ≥ 0.20 s 且总长 ≥ 0.40 s；上限 每音节 ≤ 0.55 s 且总长 ≤ 1.80 s。
2. 结构：整条只应有一段连续语音。若开头有一段短促语音（≤ 0.40 s）与后面隔着 ≥ 0.12 s 静音，
   基本可判定是词前语气词，直接切掉再复检；若末尾多出一段独立语音且整条超上限，按旧规则在
   ≥ 0.25 s 静音处截断。除此之外不截断，避免误伤词内停顿。
3. 转写复核（硬性）：用 faster-whisper 转写，要求
   - 不能以目标词之外的语气词开头（아/어/오/음/으/에/그/저/응/네…）；
   - 音节数不得少于目标词（少了＝没读完），也不得多出目标词以外的音节；
   - 与目标词的字母级相似度 ≥ 0.70（低于此视为读错或混入杂音；ASR 本身的同音误写会保留较高相似度）。
4. 不合格就换 seed 重试（最多 6 次），在合格候选里取相似度最高、其次有效时长最接近 0.30 s/音节 的一条；
   全部不合格则保留最接近的一条并标 CHECK，交人耳复核。
5. manifest 记录 term_policy：speech_seconds、per_syllable、cut_applied、asr（转写与判定）、pass。
"""
from __future__ import annotations

import difflib
import re
import tempfile
from pathlib import Path

import numpy as np

# 日语音拍比韩语音节短。2026-09-22 按 A3 样音重标：三张词卡 0.12～0.16 s/拍（名刺交換 0.13、受付 0.16、お忙しいところ 0.12），
# 上下各留余量。
MIN_PER_SYL = 0.09
MAX_PER_SYL = 0.30
MIN_TOTAL = 0.30
MAX_TOTAL = 2.00
GAP_MS = 250
LEAD_GAP_MS = 120
LEAD_MAX_MS = 400
ACTIVE_DBFS = -42.0
TARGET_PER_SYL = 0.13
MIN_RATIO = 0.70
# 转写完全对得上时的“下限放宽”：4 音节的 하다 类动词（가입하다、해지하다）自然语速下常在 0.15～0.20 s/音节，
# 只要两套 ASR 都把整词听出来，就不该按“没读完”处理。低于这里的绝对地板才算真的没读完。
MIN_PER_SYL_ASR = 0.07
MIN_TOTAL_ASR = 0.25
RATIO_TRUSTED = 0.9
from ja_text import FILLERS, decompose, kana_only  # noqa: E402
ASR_MODELS = ("small", "medium")  # 两个模型都转写：单一模型会漏听或幻听词前语气词

_models: dict[str, object] = {}


def _get_model(name: str):
    if name not in _models:
        from faster_whisper import WhisperModel

        _models[name] = WhisperModel(name, device="cpu", compute_type="int8")
    return _models[name]


def _active_frames(audio: np.ndarray, sr: int, frame_ms: int = 10) -> list[bool]:
    frame = max(1, round(sr * frame_ms / 1000))
    threshold = 10 ** (ACTIVE_DBFS / 20)
    n = len(audio) // frame
    return [float(np.sqrt(np.mean(np.square(audio[i * frame:(i + 1) * frame])))) >= threshold for i in range(n)]


def speech_seconds(audio: np.ndarray, sr: int) -> float:
    """去掉首尾静音后的有效语音时长（秒）。"""
    act = _active_frames(audio, sr)
    if not any(act):
        return 0.0
    first = act.index(True)
    last = len(act) - 1 - act[::-1].index(True)
    return round((last - first + 1) * 0.01, 4)


def segments(audio: np.ndarray, sr: int, gap_ms: int = LEAD_GAP_MS) -> list[tuple[int, int]]:
    """按 gap_ms 静音切出语音段，返回 [(起始帧, 结束帧)]（帧 = 10 ms）。"""
    act = _active_frames(audio, sr)
    out: list[list[int]] = []
    for i, on in enumerate(act):
        if not on:
            continue
        if out and i - out[-1][1] < gap_ms // 10:
            out[-1][1] = i + 1
        else:
            out.append([i, i + 1])
    return [(s, e) for s, e in out]


def strip_leading_filler(audio: np.ndarray, sr: int) -> tuple[np.ndarray, bool]:
    """切掉词前的语气词：开头一段 ≤ LEAD_MAX_MS 的短音，且与后面隔着 ≥ LEAD_GAP_MS 静音。"""
    segs = segments(audio, sr)
    if len(segs) < 2:
        return audio, False
    (s0, e0), (s1, _) = segs[0], segs[1]
    if (e0 - s0) * 10 <= LEAD_MAX_MS and (s1 - e0) * 10 >= LEAD_GAP_MS:
        frame = max(1, round(sr * 0.01))
        keep_from = max(0, (s1 * frame) - int(sr * 0.05))
        return audio[keep_from:], True
    return audio, False


def cut_after_first_gap(audio: np.ndarray, sr: int, gap_ms: int = GAP_MS) -> tuple[np.ndarray, bool]:
    """只保留第一段连续语音；语音后出现 ≥ gap_ms 静音再接其他声音时，在静音处截断。"""
    frame = max(1, round(sr * 0.01))
    act = _active_frames(audio, sr)
    started = False
    silent = 0
    for i, on in enumerate(act):
        if on:
            if started and silent * 10 >= gap_ms:
                return audio[: (i - silent) * frame], True
            started = True
            silent = 0
        elif started:
            silent += 1
    return audio, False


def evaluate(audio: np.ndarray, sr: int, syllables: int) -> dict:
    syl = max(1, syllables)
    secs = speech_seconds(audio, sr)
    per = secs / syl
    # 长词条（俗语、词组）按音节数放宽总时长，短词仍受 0.40–1.80 s 约束
    lo_total = min(MIN_TOTAL, syl * MIN_PER_SYL)
    hi_total = max(MAX_TOTAL, syl * MAX_PER_SYL)
    too_short = per < MIN_PER_SYL or secs < lo_total
    too_long = per > MAX_PER_SYL or secs > hi_total
    return {
        "speech_seconds": secs,
        "per_syllable": round(per, 4),
        "too_short": too_short,
        "too_long": too_long,
        "pass": not too_short and not too_long,
    }


def _hangul_only(text: str) -> str:
    """（沿用旧函数名，方便其它脚本不改）转成平假名读音，只留假名。"""
    return kana_only(text)


def _jamo(text: str) -> str:
    """（沿用旧函数名）把浊点拆开，让「た／だ」这类误听只扣一点相似度。"""
    return decompose(text)


def transcribe(audio: np.ndarray, sr: int) -> dict[str, str]:
    """用 ASR_MODELS 里的每个模型各转写一次，返回 {模型名: 文本}。"""
    import soundfile as sf

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as fh:
        tmp = Path(fh.name)
    try:
        sf.write(tmp, audio, sr, subtype="PCM_16")
        out = {}
        for name in ASR_MODELS:
            segs, _ = _get_model(name).transcribe(
                str(tmp), language="ja", beam_size=5, vad_filter=False, temperature=0.0
            )
            out[name] = "".join(s.text for s in segs).strip()
        return out
    finally:
        tmp.unlink(missing_ok=True)


def check_one(text: str, target: str) -> dict:
    """单个模型的转写结果判定。"""
    got = _hangul_only(text)
    want = _hangul_only(target)
    ratio = round(difflib.SequenceMatcher(None, _jamo(got), _jamo(want)).ratio(), 4) if want else 0.0
    lead_filler = bool(got) and bool(want) and got[0] != want[0] and got[0] in FILLERS
    tail_extra = len(got) > len(want) and not lead_filler
    incomplete = len(got) < len(want)
    return {
        "transcript": text,
        "hangul": got,
        "target": want,
        "ratio": ratio,
        "lead_filler": lead_filler,
        "tail_extra": tail_extra,
        "incomplete": incomplete,
        "exact": got == want,
        "pass": not lead_filler and not tail_extra and not incomplete and ratio >= MIN_RATIO and got == want,
    }


def check_transcript(texts: dict[str, str], target: str) -> dict:
    """综合两个模型的转写：任一模型听出词前语气词或多余音节即判不合格；
    音节数少于目标（没读完）同样不合格；相似度取两者较高的一个（容忍 ASR 的同音误写）。"""
    each = {name: check_one(text, target) for name, text in texts.items()}
    lead_filler = any(v["lead_filler"] for v in each.values())
    incomplete = all(v["incomplete"] for v in each.values())
    ratio = max(v["ratio"] for v in each.values()) if each else 0.0
    # 只有在"该模型自己听得挺准"的前提下，它说的"末尾多出音节"才可信。
    # 短词上 ASR 常把 회의록 听成 페이로우、일머리 听成 이유모리，这种误听不该判成音频多了尾巴；
    # 真的拖了尾巴会被时长上限挡住，不需要靠这一条。
    tail_extra = any(
        v["tail_extra"] and v["ratio"] >= RATIO_TRUSTED for v in each.values()
    )
    # 日语版（2026-09-23）：两边都已转成平假名读音，同音误写不会再拉低相似度，所以词卡要求
    # **至少一个模型的读音与目标完全一致**。起因：内線 被读成 れいせん／りせん、手土産 读成 テミアゲ，
    # 相似度 0.75～0.86 都过了 0.70 的门限，Luna 耳听才发现。
    exact = any(v["hangul"] == v["target"] for v in each.values())
    return {
        "by_model": {k: v["transcript"] for k, v in each.items()},
        "target": _hangul_only(target),
        "ratio": ratio,
        "exact": exact,
        "lead_filler": lead_filler,
        "tail_extra": tail_extra,
        "incomplete": incomplete,
        "pass": not lead_filler and not tail_extra and not incomplete and ratio >= MIN_RATIO and exact,
    }


def finalize_term(raw: np.ndarray, sr: int, syllables: int, text: str | None = None) -> tuple[np.ndarray, dict]:
    """处理一条单词朗读：只在过长时截尾、必要时切掉词前语气词，然后按时长 + 转写复核。"""
    audio = raw
    cut = False
    lead_cut = False
    info = evaluate(audio, sr, syllables)
    if info["too_long"]:
        audio, cut = cut_after_first_gap(audio, sr)
        if cut:
            info = evaluate(audio, sr, syllables)
    asr = check_transcript(transcribe(audio, sr), text) if text else None
    if asr and asr["lead_filler"]:
        stripped, lead_cut = strip_leading_filler(audio, sr)
        if lead_cut:
            retry = check_transcript(transcribe(stripped, sr), text)
            if retry["pass"]:
                audio, asr = stripped, retry
                info = evaluate(audio, sr, syllables)
            else:
                lead_cut = False
    if info["too_short"] and asr is not None and asr["pass"] and asr["ratio"] >= RATIO_TRUSTED:
        secs, per = info["speech_seconds"], info["per_syllable"]
        if per >= MIN_PER_SYL_ASR and secs >= MIN_TOTAL_ASR:
            info["too_short"] = False
            info["short_ok_by_asr"] = True
            info["pass"] = not info["too_long"]
    info["cut_applied"] = cut
    info["lead_filler_cut"] = lead_cut
    info["distance_to_target"] = round(abs(info["per_syllable"] - TARGET_PER_SYL), 4)
    if asr is not None:
        info["asr"] = asr
        info["pass"] = info["pass"] and asr["pass"]
        info["ratio"] = asr["ratio"]
    return audio, info


# ---- 语气（播音腔）校验：防止读得低落／句末下坠 ----

# ---- 句子（对话）专用的两道闸 ----
# 起因（2026-09-18）：Luna 听出 custom-07 的 니까／봤어、custom-08 的 앉죠 句尾被切掉，
# custom-07 有一条句首多了个「啊」。实测发现是**模型没把话生成完**（切断点之后是近乎全零），
# 不是裁切切掉的 —— 所以补时长救不回来，只能「检出来 + 换 seed 重录」。
# 之前单词卡要过 ASR 转写关、对话句不过，这类问题才会一路溜到线上。
SENTENCE_MIN_RATIO = 0.88      # 整句转写相似度
SENTENCE_TAIL_SYL = 3          # 比对句尾这么多个假名（日语句尾 です／ます 本身就两拍，多看一拍）
SENTENCE_TAIL_RATIO = 0.80     # 句尾相似度
TAIL_MARGIN_DB = -18.0         # 最后一帧人声至少要比该条的「说话音量」低这么多
TAIL_MARGIN_DB_CLONE = -20.0   # 声纹克隆（B）整体收尾更抖，收紧一档


def tail_cliff(audio: np.ndarray, sr: int, frame_ms: int = 10, floor_rel_db: float = -30.0) -> dict:
    """量句尾是不是「断崖」：自然收尾会一路衰减，被切断则停在接近说话音量的地方。

    margin_db —— 最后一帧人声比该条的说话音量低多少（越接近 0 越像被切断）
    cliff_db  —— 最后一步跌了多少 dB
    """
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    step = max(1, int(sr * frame_ms / 1000))
    frames = [
        float(np.sqrt(np.mean(np.square(mono[i : i + step]))))
        for i in range(0, max(0, len(mono) - step), step)
    ]
    if not frames:
        return {"margin_db": None, "cliff_db": None, "pass": True}
    peak = max(frames) or 1e-9
    loud = [v for v in frames if v > peak * 10 ** (-30 / 20)]
    if not loud:
        return {"margin_db": None, "cliff_db": None, "pass": True}
    active = float(np.median(loud))                      # 这条音频的「说话音量」
    floor = active * 10 ** (floor_rel_db / 20)
    idx = [i for i, v in enumerate(frames) if v > floor]
    if not idx:
        return {"margin_db": None, "cliff_db": None, "pass": True}
    last = idx[-1]
    to_db = lambda v: -99.0 if v <= 0 else 20 * float(np.log10(v / active))
    margin = to_db(frames[last])
    nxt = frames[last + 1] if last + 1 < len(frames) else 0.0
    return {
        "margin_db": round(margin, 1),
        "cliff_db": round(margin - to_db(nxt), 1),
        "pass": True,  # 由调用方按声线的阈值判定
    }


TAIL_FADE_MAX_STEP_DB = 12.0
TAIL_FADE_REF_DB = -6.0
TAIL_FADE_FLOOR_DB = -30.0


def tail_fade(audio: np.ndarray, sr: int, frame_ms: int = 10) -> dict:
    """看句尾的衰减是不是「一步跌下去」的。

    只看收尾电平（tail_cliff 的 margin_db）会漏掉一类：最后一帧确实很低，
    但它是从 -4 dB 一帧之内掉到 -27 dB 的 —— 听感上就是话被砍断。
    自然收尾是连着几帧each 掉几 dB，所以这里量**衰减过程中最大的单帧跌幅**。
    """
    mono = audio.mean(axis=1) if audio.ndim > 1 else audio
    step = max(1, int(sr * frame_ms / 1000))
    frames = [
        float(np.sqrt(np.mean(np.square(mono[i : i + step]))))
        for i in range(0, max(0, len(mono) - step), step)
    ]
    if not frames:
        return {"fade_ms": None, "max_step_db": None, "pass": True}
    peak = max(frames) or 1e-9
    loud = [v for v in frames if v > peak * 10 ** (-30 / 20)]
    if not loud:
        return {"fade_ms": None, "max_step_db": None, "pass": True}
    act = float(np.median(loud))
    to_db = lambda v: -99.0 if v <= 0 else 20 * float(np.log10(v / act))
    above = [i for i, v in enumerate(frames) if to_db(v) > TAIL_FADE_FLOOR_DB]
    if not above:
        return {"fade_ms": None, "max_step_db": None, "pass": True}
    end = above[-1]
    start = end
    for i in range(end, -1, -1):
        if to_db(frames[i]) > TAIL_FADE_REF_DB:
            start = i
            break
    max_step = 0.0
    for i in range(start, end):
        drop = to_db(frames[i]) - to_db(frames[i + 1])
        if drop > max_step:
            max_step = drop
    return {
        "fade_ms": (end - start) * frame_ms,
        "max_step_db": round(max_step, 1),
        "pass": max_step <= TAIL_FADE_MAX_STEP_DB,
    }


def tail_cliff_check(audio: np.ndarray, sr: int, is_clone: bool = False) -> dict:
    info = tail_cliff(audio, sr)
    limit = TAIL_MARGIN_DB_CLONE if is_clone else TAIL_MARGIN_DB
    info["limit_db"] = limit
    info["pass"] = info["margin_db"] is None or info["margin_db"] <= limit
    return info


def _tail(text: str, n: int = SENTENCE_TAIL_SYL) -> str:
    return text[-n:] if len(text) >= n else text


def _head(text: str, n: int = SENTENCE_TAIL_SYL) -> str:
    return text[:n] if len(text) >= n else text


def check_sentence(texts: dict[str, str], target: str) -> dict:
    """对话句的转写判定：整句相似度 + **句尾**相似度 + 句首语气词。

    句尾单独比对，是因为「少读了最后一个音节」在整句相似度上只掉几个百分点，
    但听感上就是话没说完 —— 这正是 Luna 反馈的那一类。
    """
    want = _hangul_only(target)
    each = {}
    for name, text in texts.items():
        got = _hangul_only(text)
        ratio = round(difflib.SequenceMatcher(None, _jamo(got), _jamo(want)).ratio(), 4) if want else 0.0
        tail_ratio = (
            round(difflib.SequenceMatcher(None, _jamo(_tail(got)), _jamo(_tail(want))).ratio(), 4)
            if want else 0.0
        )
        each[name] = {
            "transcript": text,
            "hangul": got,
            "ratio": ratio,
            "tail_ratio": tail_ratio,
            # 句首也要比：2026-09-21 Luna 听出 custom-08 d05 开头的「그렇군요.」被吞掉一半，
            # 整句相似度只掉一点、句尾完全正常，所以之前的闸门都放过了。
            "head_ratio": (
                round(difflib.SequenceMatcher(None, _jamo(_head(got)), _jamo(_head(want))).ratio(), 4)
                if want else 0.0
            ),
            # 句首赘音判定：光看「第一个字是语气词且与原文不同」会误伤 —— 原文本身
            # 就以 네./음…/응, 开头时，ASR 常把它听成同类的另一个语气词（음→응）。
            # 真正的赘音去掉后与原文的相似度会明显上升，原文自带的语气词去掉则会下降。
            "lead_filler": (
                bool(got) and bool(want) and got[0] != want[0] and got[0] in FILLERS
                and difflib.SequenceMatcher(None, _jamo(got[1:]), _jamo(want)).ratio()
                > difflib.SequenceMatcher(None, _jamo(got), _jamo(want)).ratio() + 0.02
            ),
        }
    ratio = max((v["ratio"] for v in each.values()), default=0.0)
    tail_ratio = max((v["tail_ratio"] for v in each.values()), default=0.0)
    head_ratio = max((v["head_ratio"] for v in each.values()), default=0.0)
    lead_filler = any(v["lead_filler"] for v in each.values())
    return {
        "by_model": {k: v["transcript"] for k, v in each.items()},
        "target": want,
        "ratio": ratio,
        "tail_ratio": tail_ratio,
        "head_ratio": head_ratio,
        "lead_filler": lead_filler,
        "pass": (not lead_filler) and ratio >= SENTENCE_MIN_RATIO and tail_ratio >= SENTENCE_TAIL_RATIO
        and head_ratio >= SENTENCE_TAIL_RATIO,
    }


def median_f0(audio: np.ndarray, sr: int) -> float:
    """自相关粗测基频，只取有声帧的中位数。"""
    win, hop = int(sr * 0.04), int(sr * 0.02)
    vals = []
    for i in range(0, max(0, len(audio) - win), hop):
        frame = audio[i : i + win]
        if float(np.sqrt(np.mean(frame.astype(np.float64) ** 2))) < 10 ** (-40 / 20):
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


def prosody_check(audio: np.ndarray, sr: int, baseline_f0: float, quality: dict, is_sentence: bool = False) -> dict:
    """整体音高明显低于 baseline，或句末音高大幅下坠 → 判为情绪不中立，需要换 seed 重生成。"""
    low_ratio = quality.get("low_pitch_ratio", 0.90)
    fall_ratio = (
        quality.get("falling_tail_ratio_sentence", 0.62)
        if is_sentence
        else quality.get("falling_tail_ratio", 0.75)
    )
    f0 = median_f0(audio, sr)
    # 末端要先剥掉补进去的静音，否则量到的是空白
    act = np.flatnonzero(np.abs(audio) >= 10 ** (-45 / 20))
    end = int(act[-1]) + 1 if len(act) else len(audio)
    tail = median_f0(audio[max(0, end - int(sr * 0.4)) : end], sr)
    vs_base = round(f0 / baseline_f0, 3) if baseline_f0 and f0 else 0.0
    vs_med = round(tail / f0, 3) if f0 and tail else 0.0
    low = bool(vs_base and vs_base < low_ratio)
    falling = bool(vs_med and vs_med < fall_ratio)
    return {
        "median_f0": round(f0, 1),
        "baseline_f0": baseline_f0,
        "f0_vs_baseline": vs_base,
        "tail_f0": round(tail, 1),
        "tail_vs_median": vs_med,
        "low_pitch": low,
        "falling_tail": falling,
        "pass": not (low or falling),
    }


# ---- 音色校验：与该声线参考朗读的 MFCC 距离，抓哭腔／喉音／气声 ----
_ref_cache: dict[str, np.ndarray] = {}


def _mel_bank(sr: int, n_fft: int = 2048, n_mels: int = 26) -> np.ndarray:
    def hz2mel(f):
        return 2595 * np.log10(1 + f / 700)

    def mel2hz(m):
        return 700 * (10 ** (m / 2595) - 1)

    edges = mel2hz(np.linspace(hz2mel(80), hz2mel(sr / 2), n_mels + 2))
    freqs = np.fft.rfftfreq(n_fft, 1 / sr)
    bank = np.zeros((n_mels, len(freqs)))
    for i in range(n_mels):
        lo, mid, hi = edges[i], edges[i + 1], edges[i + 2]
        up = (freqs >= lo) & (freqs <= mid)
        dn = (freqs >= mid) & (freqs <= hi)
        bank[i, up] = (freqs[up] - lo) / max(mid - lo, 1e-9)
        bank[i, dn] = (hi - freqs[dn]) / max(hi - mid, 1e-9)
    return bank


def timbre_vector(audio: np.ndarray, sr: int) -> np.ndarray:
    """有声帧的平均 MFCC（去掉能量维），归一化后用余弦距离比较音色。"""
    audio = np.asarray(audio, dtype=np.float64)
    bank = _mel_bank(sr)
    win, hop = int(sr * 0.04), int(sr * 0.02)
    vecs = []
    for i in range(0, max(0, len(audio) - win), hop):
        fr = audio[i : i + win]
        if float(np.sqrt(np.mean(fr**2))) < 10 ** (-40 / 20):
            continue
        spec = np.abs(np.fft.rfft(fr * np.hanning(win), n=2048)) ** 2
        mel = np.log(bank @ spec + 1e-12)
        vecs.append(np.fft.rfft(mel).real[1:14])
    if not vecs:
        return np.zeros(13)
    v = np.mean(vecs, axis=0)
    return v / (np.linalg.norm(v) or 1.0)


def reference_vector(ref_path, sr_expected: int) -> np.ndarray:
    key = str(ref_path)
    if key not in _ref_cache:
        import soundfile as sf

        a, sr = sf.read(str(ref_path), always_2d=False)
        if np.asarray(a).ndim > 1:
            a = np.asarray(a).mean(axis=1)
        _ref_cache[key] = timbre_vector(np.asarray(a), sr)
    return _ref_cache[key]


def timbre_check(audio: np.ndarray, sr: int, ref_path, quality: dict) -> dict:
    """音色离参考朗读太远 → 多半是哭腔／喉音／气声之类的"演"，换 seed 重生成。"""
    limit = quality.get("timbre_distance_max", 0.45)
    try:
        ref = reference_vector(ref_path, sr)
    except Exception:
        return {"distance": None, "limit": limit, "pass": True}
    dist = float(1 - np.dot(timbre_vector(audio, sr), ref))
    return {"distance": round(dist, 4), "limit": limit, "pass": bool(dist <= limit)}


def accept_best_timbre(manifest: dict) -> dict:
    """音色距离部分取决于词本身的音素内容（外来语如 피드백 天然离参考句更远），
    所以在跑满所有 seed 之后，只要其它各关都过，就收下音色最接近参考的那一条，
    并在 manifest 里标记 accepted_as_best，留给人耳复核时优先抽查。"""
    tb = manifest.get("timbre")
    if not tb or tb.get("pass"):
        return manifest
    # 日语版（2026-09-23）：距离太远就不兜底收下 —— 少々（0.78）、名乗る（0.41）被 Luna 听出「声音不一样」。
    if (tb.get("distance") or 0) > 0.40:
        return manifest
    others_ok = manifest["quality_assessment"]["automatic_pass"] and manifest.get(
        "term_policy", {"pass": True}
    )["pass"] and manifest.get("prosody", {"pass": True})["pass"]
    if others_ok:
        tb["accepted_as_best"] = True
        tb["note"] = "跑满 seed 后取音色最接近参考的一条；距离偏高多半来自该词的音素内容而非语气，建议人耳抽查。"
        tb["pass"] = True
    return manifest
