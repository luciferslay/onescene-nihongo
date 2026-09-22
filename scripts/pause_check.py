"""句中不自然停顿检查（2026-09-20 Luna：custom-17「올라오자마자」中间断开了 370ms）。

一句话里，没有标点的地方不该出现长停顿。做法：10ms 分帧找出 >= GAP_MS 的静音，
数量超过句中标点（, . ? ! …）的个数，就判定有多余停顿。只依赖 numpy。
"""
import re
import numpy as np

GAP_MS = 250


def internal_gaps(wav: np.ndarray, sr: int, min_ms: int = GAP_MS):
    fr = max(1, int(sr * 0.01))
    n = max(0, len(wav) - fr) // fr
    if n < 5:
        return []
    lv = np.array([np.sqrt(np.mean(np.square(wav[i * fr:(i + 1) * fr]))) for i in range(n)])
    act = float(np.median(lv[lv > lv.max() * 10 ** (-30 / 20)]))
    on = np.where(lv > act * 10 ** (-30 / 20))[0]
    out = []
    for k in range(1, len(on)):
        ms = (on[k] - on[k - 1] - 1) * 10
        if ms >= min_ms:
            out.append((on[k - 1] / 100, ms))
    return out


def allowed_pauses(text: str) -> int:
    body = text.strip().rstrip(".?!…~。？！")
    return len(re.findall(r"[,.?!…、。？！]", body))


def pause_ok(wav: np.ndarray, sr: int, text: str):
    g = internal_gaps(wav, sr)
    return len(g) <= allowed_pauses(text), g
