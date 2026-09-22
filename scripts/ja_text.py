"""日语文本工具：音拍计数、读音归一（给 ASR 比对用）、语气词表。

韩语站里这些事很简单：一个谚文音节就是一个音节，`[가-힣]` 一数就完。日语麻烦在两点：
1. 课文和词卡里有汉字，音拍数得先转成读音再数（「名刺交換」= めいしこうかん = 7 拍）；
2. ASR（whisper）吐出来的是汉字假名混写，同一句话可能写成「頂く」也可能写成「いただく」，
   直接比字符串会误判，所以比对前把两边都转成平假名读音。

汉字→读音用 pykakasi（纯 Python，uv 装得快）。它对多音字偶尔会读错，但两边用同一套规则转，
误差会互相抵消；音拍计数差一两拍对语速门限影响不大。
"""
from __future__ import annotations

import re
import unicodedata

_kks = None


def _kakasi():
    global _kks
    if _kks is None:
        import pykakasi

        _kks = pykakasi.kakasi()
    return _kks


# ASR 常把数词写成阿拉伯数字（「三時」→「3時」），比对前还原成读音。只处理单个数字，够用。
_DIGIT = {"0": "ぜろ", "1": "いち", "2": "に", "3": "さん", "4": "よん",
          "5": "ご", "6": "ろく", "7": "なな", "8": "はち", "9": "きゅう"}

_KATA_TO_HIRA = {code: code - 0x60 for code in range(0x30A1, 0x30F7)}


def to_hiragana(text: str) -> str:
    """汉字→平假名读音，片假名→平假名，其余字符原样。"""
    text = "".join(_DIGIT.get(ch, ch) for ch in text)
    out = []
    for item in _kakasi().convert(text):
        out.append(item["hira"])
    return "".join(out).translate(_KATA_TO_HIRA)


def kana_only(text: str) -> str:
    """只留平假名读音（含长音「ー」），去掉标点、空格、拉丁字母。这是 ASR 比对的基准形。"""
    return re.sub(r"[^ぁ-ゖー]", "", to_hiragana(text))


def decompose(text: str) -> str:
    """把浊点／半浊点拆成独立字符（NFD），让「た/だ」这类只差一个浊点的误听在相似度上只扣一点，
    作用等于韩语站的 _jamo（把音节拆成字母级再比）。"""
    return unicodedata.normalize("NFD", text)


_SMALL_YOUON = set("ゃゅょャュョ")   # 拗音不单独成拍
_SMALL_VOWEL = set("ぁぃぅぇぉァィゥェォ")  # 外来语里的小写元音（ファ、ティ）也并入前一拍


def mora_count(text: str) -> int:
    """数音拍：假名逐个算 1 拍，拗音（ゃゅょ）和小写元音并入前一拍，っ／ん／ー各算 1 拍。汉字先转读音。"""
    kana = to_hiragana(text)
    n = 0
    for ch in kana:
        if "ぁ" <= ch <= "ゖ" or ch == "ー":
            if ch in _SMALL_YOUON or ch in _SMALL_VOWEL:
                continue
            n += 1
    return n


# 词前语气词（单独成卡时不该出现）。判定方式与韩语站相同：去掉首字后与原文相似度明显上升才算赘音，
# 所以这里列得宽一点也不会误伤「あの」「はい」这类原文自带的开头。
FILLERS = set("あえうおんーえっはま")


_READINGS = None


def tts_reading(text: str) -> str:
    """送进 TTS 之前按 tts_readings.json 把容易读错的汉字换成假名（页面原文不变）。"""
    global _READINGS
    if _READINGS is None:
        import json
        from pathlib import Path

        path = Path(__file__).resolve().parents[1] / "tts_readings.json"
        _READINGS = json.loads(path.read_text(encoding="utf-8")).get("readings", {}) if path.exists() else {}
    for src in sorted(_READINGS, key=len, reverse=True):
        text = text.replace(src, _READINGS[src])
    return text
