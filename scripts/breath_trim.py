"""句末气声（叹气、吸气）检测与切除 —— 只依赖 numpy，VM 里也能跑。

2026-09-20 Luna 反馈：custom-16 dialogue-03 句末混进一声叹气。查下来是句子说完后
隔了 0.7 秒又出了两段高过零率的气声（-50 dB 的吸气 + 接近说话音量的叹气），
哨兵法只在「네」之前的最后一段停顿处切，气声正好夹在句子和「네」之间，所以被留了下来。
"""
import numpy as np

BREATH_GAP_MS = 150      # 句末人声与气声之间至少隔这么久的静音才算「另一段」
BREATH_ZCR = 0.12        # 过零率高于这个 = 清音/气声（元音一般 < 0.06）
BREATH_RATIO = 0.6       # 一段里至少这么多帧是气声，才算整段是气声
LEAD_RATIO = 0.8        # 句首：至少八成帧是气声
LEAD_BELOW_DB = -6.0    # 句首：比正常说话至少低 6 dB
LEAD_MAX_MS = 400       # 句首：不超过 0.4 秒
LEAD_MIN_GAP_MS = 300   # 句首：和后面的人声之间隔着至少 0.3 秒静音
BREATH_MIN_MS = 80       # 短于这个的是咔哒声之类，听不出来，不管
BREATH_BELOW_DB = 0.0    # 这一段最响处不超过正常说话的中位音量（叹气可以挺响，但到不了说话的峰值）


def _frames(wav: np.ndarray, sr: int):
    frame = max(1, int(sr * 0.01))
    n = max(0, len(wav) - frame) // frame
    lv = np.array([np.sqrt(np.mean(np.square(wav[i * frame:(i + 1) * frame]))) for i in range(n)])
    zc = np.array([np.mean(np.abs(np.diff(np.sign(wav[i * frame:(i + 1) * frame])))) / 2 for i in range(n)])
    return frame, n, lv, zc


def _segments(lv: np.ndarray, n: int):
    peak = lv.max() or 1e-9
    act = float(np.median(lv[lv > peak * 10 ** (-30 / 20)]))
    on = lv > act * 10 ** (-35 / 20)
    segs, i = [], 0
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            if segs and i - segs[-1][1] < BREATH_GAP_MS // 10:
                segs[-1] = (segs[-1][0], j)
            else:
                segs.append((i, j))
            i = j
        else:
            i += 1
    return act, segs


def trailing_breath(wav: np.ndarray, sr: int):
    """返回句末气声的起点帧（10ms 帧），没有就返回 None。"""
    frame, n, lv, zc = _frames(wav, sr)
    if n < 10:
        return None, frame
    act, segs = _segments(lv, n)
    cut = None
    while len(segs) >= 2:
        a, b = segs[-1]
        if (b - a) * 10 < BREATH_MIN_MS:
            segs.pop()
            continue
        breathy = float(np.mean(zc[a:b] > BREATH_ZCR))
        top = 20 * np.log10(lv[a:b].max() / act)
        if breathy >= BREATH_RATIO and top < BREATH_BELOW_DB:
            segs.pop()
            cut = segs[-1][1]
        else:
            break
    return cut, frame


def strip_trailing_breath(wav: np.ndarray, sr: int, keep_after_ms: int = 120):
    """去掉句末人声之后的叹气、吸气声。返回 (音频, 切掉的秒数)。"""
    cut, frame = trailing_breath(wav, sr)
    if cut is None:
        return wav, 0.0
    end = min(len(wav), (cut + keep_after_ms // 10) * frame)
    return wav[:end], (len(wav) - end) / sr


def leading_breath(wav: np.ndarray, sr: int):
    """返回句首气声（吸气、咂嘴、杂音）结束的帧号，没有就返回 None。与 trailing_breath 对称。

    2026-09-21 Luna：杂音也可能出现在句子前面。
    """
    frame, n, lv, zc = _frames(wav, sr)
    if n < 10:
        return None, frame
    act, segs = _segments(lv, n)
    cut = None
    while len(segs) >= 2:
        a, b = segs[0]
        if (b - a) * 10 < BREATH_MIN_MS:
            segs.pop(0)
            cut = segs[0][0]
            continue
        breathy = float(np.mean(zc[a:b] > BREATH_ZCR))
        top = 20 * np.log10(lv[a:b].max() / act)
        gap = (segs[1][0] - b) * 10
        # 句首比句末严格得多：ㅊ/ㅅ/ㅎ 这类送气、擦音开头本身就是高过零率，
        # 「아이고」这种叹词也可能读得很虚。所以只切「短、轻、后面隔了一段静音」的那种。
        # 很轻的（比说话低 18 dB 以上）短杂音不管是不是气声都切：咂嘴、衣服摩擦、键盘声之类
        quiet_noise = top < -18.0
        if ((breathy >= LEAD_RATIO or quiet_noise) and top < LEAD_BELOW_DB
                and (b - a) * 10 <= LEAD_MAX_MS and gap >= LEAD_MIN_GAP_MS):
            segs.pop(0)
            cut = segs[0][0]
        else:
            break
    return cut, frame


def strip_leading_breath(wav: np.ndarray, sr: int, keep_before_ms: int = 60):
    """去掉句首人声之前的吸气、杂音。返回 (音频, 切掉的秒数)。"""
    cut, frame = leading_breath(wav, sr)
    if cut is None:
        return wav, 0.0
    start = max(0, (cut - keep_before_ms // 10) * frame)
    return wav[start:], start / sr


def strip_breath_both(wav: np.ndarray, sr: int):
    """句首、句末的气声杂音一起去掉。返回 (音频, 句首切掉秒数, 句末切掉秒数)。"""
    wav, head = strip_leading_breath(wav, sr)
    wav, tail = strip_trailing_breath(wav, sr)
    return wav, head, tail
