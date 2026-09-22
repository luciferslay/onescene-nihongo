"""把大纲 LESSON_DRAFT_*.md 里选择题的正确答案打散（规则同 shuffle_answers.py）。
用法：python3 scripts/shuffle_draft_answers.py ../LESSON_DRAFT_custom-22-23.md [...]"""
import re, sys, math, random, hashlib, pathlib

C = '①②③④'
INLINE = re.compile(r'^(.*?)① (.*?)　② (.*?)　③ (.*?)　④ (.*?)　→ \*\*([①②③④])\*\*(.*)$')


def remap(txt, old2new):
    return ''.join(C[old2new[C.index(ch)]] if ch in C else ch for ch in txt)


def plan(key, sizes, prev):
    n = sum(sizes.values()); cap = math.ceil(n / 4)
    for attempt in range(10000):
        rng = random.Random(hashlib.sha256(f'{key}|{attempt}'.encode()).digest())
        res, cnt, ok = {}, [0] * 4, True
        for g, k in sizes.items():
            seq = rng.sample(range(4), k)
            if (k >= 2 and prev.get(g) == seq) or (k >= 3 and all(seq[i+1]-seq[i] == seq[1]-seq[0] for i in range(k-1))):
                ok = False; break
            for p in seq: cnt[p] += 1
            res[g] = seq
        if ok and max(cnt) <= cap:
            return res


def process(path):
    lines = pathlib.Path(path).read_text().split('\n')
    # 找出所有题目：(课序号, 组名, 行号信息)
    qs, lesson, group = [], None, None
    i = 0
    while i < len(lines):
        l = lines[i]
        if re.match(r'# (网站)?第 ', l) and '课' in l:
            lesson = l.split('课')[0]; group = None
        elif l.startswith('## 练习') or l.startswith('## 换个说法'): group = 'grammar'
        elif l.startswith('## 场景理解'): group = 'feeling'
        elif l.startswith('## 语法原型'): group = 'meaning'
        elif l.startswith('## 4/6'): group = 'error'
        elif l.startswith('## '): group = None
        if group and lesson:
            m = INLINE.match(l)
            if m:
                qs.append((lesson, group, 'inline', i)); i += 1; continue
            if l.startswith('① ') and i + 4 < len(lines) and lines[i+4].startswith('→ **'):
                qs.append((lesson, group, 'multi', i)); i += 5; continue
        i += 1
    prev = {}
    for lesson in dict.fromkeys(q[0] for q in qs):
        mine = [q for q in qs if q[0] == lesson]
        sizes = {}
        for q in mine: sizes[q[1]] = sizes.get(q[1], 0) + 1
        seqs = plan(f'{pathlib.Path(path).name}|{lesson}', sizes, prev); prev = seqs
        idx = {g: 0 for g in sizes}
        for _, g, kind, i in mine:
            target = seqs[g][idx[g]]; idx[g] += 1
            if kind == 'inline':
                m = INLINE.match(lines[i]); opts = list(m.group(2, 3, 4, 5)); ans = C.index(m.group(6)); tail = m.group(7); head = m.group(1)
            else:
                opts = [lines[i+k][2:] for k in range(4)]
                mm = re.match(r'→ \*\*([①②③④])\*\*(.*)$', lines[i+4]); ans = C.index(mm.group(1)); tail = mm.group(2)
            rest = [k for k in range(4) if k != ans]
            new_idx = rest[:target] + [ans] + rest[target:]
            old2new = {o: n for n, o in enumerate(new_idx)}
            new_opts = [opts[k] for k in new_idx]
            tail = remap(tail, old2new)
            if kind == 'inline':
                lines[i] = head + '　'.join(f'{C[k]} {o}' for k, o in enumerate(new_opts)) + f'　→ **{C[target]}**' + tail
            else:
                for k in range(4): lines[i+k] = f'{C[k]} {new_opts[k]}'
                lines[i+4] = f'→ **{C[target]}**' + tail
        print(path, lesson, {g: ''.join(str(x+1) for x in s) for g, s in seqs.items()})
    pathlib.Path(path).write_text('\n'.join(lines))


for p in sys.argv[1:]:
    process(p)
