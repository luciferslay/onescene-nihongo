"""检查附加单词有没有出现在课文里（Luna 2026-09-21：课文里出现的词一律进本课单词）。日语版。
用法：python3 scripts/check_bonus_in_dialogue.py

日语的词在句子里会变形（確認する→確認して／確認いたします、忙しい→忙しく），所以按「词干」找：
- 动词 する 结尾：去掉 する 后的汉语部分（確認）；一段动词去 る；五段动词去掉最后一个假名；
- い形容词去 い；な形容词去 な／だ；
- 多词短语只看最长的那个片段。词干太短（1 个字）不查，避免误报。
"""
import glob
import re

Q = r"'((?:[^'\\]|\\.)*)'"


def stems(word: str) -> set[str]:
    w = word.strip()
    out = {w}
    for suf in ("する", "です", "だ", "な"):
        if w.endswith(suf) and len(w) > len(suf) + 1:
            out.add(w[: -len(suf)])
    if re.search(r"[うくぐすつぬぶむる]$", w) and len(w) >= 3:
        out.add(w[:-1])
    if w.endswith("い") and len(w) >= 3:
        out.add(w[:-1])
    for part in re.split(r"[ 　・を に が の は と で へ]", w):
        if len(part) >= 2:
            out.add(part)
    return {x for x in out if len(x) >= 2}


res = {}
for f in sorted(glob.glob("lib/lessons/*.ts")):
    s = open(f, encoding="utf-8").read()
    if "bonusWords" not in s:
        continue
    dia = " ".join(re.findall(r"text: " + Q, s))
    b = s[s.index("bonusWords"):]
    words = re.findall(r"ja: " + Q, b)
    hits = [w for w in words if any(st in dia for st in stems(w))]
    if hits:
        res[f] = hits
for f, h in res.items():
    print(f.split("/")[-1], h)
if not res:
    print("附加单词没有出现在课文里，通过")
