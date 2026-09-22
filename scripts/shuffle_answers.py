"""全站选择题正确答案落点重排（2026-09-20，Luna：答案不能固定在同一个位置）。

覆盖每课的 feeling / meaning（ChoiceQuestion）、grammarTests、errorTests。
规则（写在 WORD_RULES.md 第 6 节）：
  1. 同一组题（如一课的 3 道 grammarTests）正确答案的位置互不相同；
  2. 一课里所有选择题，每个位置最多出现 ceil(题数/4) 次；
  3. 同一组的落点序列不能和上一课同组一样，三题以上的组也不能是 1-2-3、4-3-2 这种连号；
  4. 用 sha256 定种子，结果稳定可复现（不能用 crc32，见 shuffle_error_choices.py 的教训）。
explain / success / hint 里用 ①②③④ 指代选项的，按新顺序同步改号。
用法：python3 scripts/shuffle_answers.py [--dry]
"""
import re, sys, glob, math, random, hashlib, pathlib

Q = r"'((?:[^'\\]|\\.)*)'"
CIRC = '①②③④'
ITEM = re.compile(r"choices: \[(.*?)\]\s*,(\s*\n\s*)correct: " + Q, re.S)


def order():
    t = pathlib.Path('lib/lessons/index.ts').read_text()
    names = []
    for key in ('lessons', 'pendingLessons'):
        m = re.search(r'export const ' + key + r'[^=]*= \[(.*?)\];', t, re.S)
        if m:
            names += re.findall(r'(\w+)', m.group(1))
    return list(dict.fromkeys(names))


def lesson_files():
    out = {}
    for f in glob.glob('lib/lessons/*.ts'):
        s = pathlib.Path(f).read_text()
        m = re.search(r'export const (\w+): Lesson', s)
        if m:
            out[m.group(1)] = f
    return out


ELEM = re.compile(r"\{[^{}]*\}|" + Q)


def split_elems(body):
    """把 choices 里的四个元素切出来；元素之间的分隔（逗号、换行、缩进）原样保留。"""
    spans = [m.span() for m in ELEM.finditer(body)]
    elems = [body[x:y] for x, y in spans]
    vals = []
    for e in elems:
        m = re.search(r"value: " + Q, e) or re.search(Q, e)
        vals.append(m.group(1))
    return elems, vals, spans


def rebuild(body, spans, new_elems):
    out, last = [], 0
    for (x, y), e in zip(spans, new_elems):
        out.append(body[last:x]); out.append(e); last = y
    out.append(body[last:])
    return ''.join(out)


def section_of(s, pos):
    secs = [(m.start(), m.group(1)) for m in re.finditer(r'^  (\w+): [\[{]', s, re.M)]
    return [k for v, k in secs if v < pos][-1]


def plan(stem, groups, prev):
    n = sum(len(g) for _, g in groups)
    cap = math.ceil(n / 4)
    for attempt in range(10000):
        rng = random.Random(hashlib.sha256(f'{stem}|{attempt}'.encode()).digest())
        res, cnt, ok = {}, [0] * 4, True
        for name, items in groups:
            k = len(items)
            seq = rng.sample(range(4), k) if k <= 4 else [rng.randrange(4) for _ in range(k)]
            if k >= 2 and prev.get(name) == seq:
                ok = False; break
            # 1-2-3、4-3-2 这种连号看起来也像规律，不要
            if k >= 3 and all(seq[i + 1] - seq[i] == seq[1] - seq[0] for i in range(k - 1)):
                ok = False; break
            for p in seq:
                cnt[p] += 1
            res[name] = seq
        if ok and max(cnt) <= cap:
            return res
    raise SystemExit(f'{stem}: 找不到满足规则的排法')


def run(dry):
    files = lesson_files()
    prev = {}
    for name in order():
        f = files.get(name)
        if not f:
            continue
        p = pathlib.Path(f); s = p.read_text(); stem = p.stem
        items = []
        for m in ITEM.finditer(s):
            elems, vals, multi = split_elems(m.group(1))
            if m.group(3) not in vals or len(vals) != 4:
                continue
            items.append((m, elems, vals, multi, section_of(s, m.start())))
        groups = []
        for it in items:
            if not groups or groups[-1][0] != it[4]:
                groups.append((it[4], []))
            groups[-1][1].append(it)
        seqs = plan(stem, [(g, its) for g, its in groups], prev)
        prev = seqs
        # 从后往前替换，保证偏移不乱
        edits = []
        for g, its in groups:
            for it, target in zip(its, seqs[g]):
                m, elems, vals, multi, _ = it
                ci = vals.index(m.group(3))
                rest = [i for i in range(4) if i != ci]
                new_idx = rest[:target] + [ci] + rest[target:]   # new_idx[新位置] = 旧位置
                old2new = {o: n for n, o in enumerate(new_idx)}
                new_elems = [elems[i] for i in new_idx]
                body = rebuild(m.group(1), multi, new_elems)
                edits.append((m.start(1), m.end(1), body, m.end(), old2new))
        out = s
        for a, b, body, tail, old2new in sorted(edits, reverse=True):
            # 同步改 explain/success/hint 里的 ①～④
            nxt = out.find('choices: [', tail)
            seg_end = nxt if nxt != -1 else len(out)
            seg = out[tail:seg_end]
            fm = re.search(r"(explain|success|hint):\s*\n?\s*" + Q, seg)
            if fm and any(c in fm.group(2) for c in CIRC):
                txt = fm.group(2)
                newtxt = ''.join(CIRC[old2new[CIRC.index(ch)]] if ch in CIRC else ch for ch in txt)
                seg = seg[:fm.start(2)] + newtxt + seg[fm.end(2):]
                out = out[:tail] + seg + out[seg_end:]
            out = out[:a] + body + out[b:]
        summary = ' '.join(f"{g}={''.join(str(x + 1) for x in seqs[g])}" for g, _ in groups)
        print(f'{stem:18s} {summary}')
        if not dry and out != s:
            p.write_text(out)


run('--dry' in sys.argv)
