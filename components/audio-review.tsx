'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Clip = { kind: string; ja: string; zh: string; src: string };
type LessonItem = {
  id: string;
  number: number;
  pending: boolean;
  title: string;
  grammar: string;
  clips: Clip[];
};
type Verdict = { v: 'ok' | 'bad'; type?: number; note?: string; sha?: string };

/** 问题分类（Luna 2026-09-21）。1～4 由 Claude 以同课没问题的音频为基准重录；5 需要写具体问题。 */
const ISSUE_TYPES = [
  { n: 1, label: '没录全' },
  { n: 2, label: '有多余杂音' },
  { n: 3, label: '语气不自然' },
  { n: 4, label: '语速不自然' },
  { n: 5, label: '其他' },
] as const;
type Auto = { pass: boolean; why: string[]; sha?: string };

const STORE = 'audio-review-v1';
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '没听过 / 重录过' },
  { key: 'flag', label: '自动检查没过' },
  { key: 'bad', label: '我标了有问题' },
] as const;

function load(): Record<string, Verdict> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || '{}');
  } catch {
    return {};
  }
}

function autoCheck(m: Record<string, any>): Auto {
  const why: string[] = [];
  if (m.quality_assessment && !m.quality_assessment.automatic_pass) why.push('语速/音量');
  if (m.term_policy && !m.term_policy.pass) why.push('词音');
  if (m.prosody && !m.prosody.pass) why.push('语调');
  if (m.timbre && m.timbre.pass === false) why.push('音色');
  if (m.internal_pause && !m.internal_pause.pass) why.push('句中停顿');
  if (m.sentence_asr && !m.sentence_asr.pass) why.push('听写不符');
  if (m.tail_fade && !m.tail_fade.pass) why.push('句尾');
  return { pass: why.length === 0, why, sha: m.output_sha256 };
}

export default function AudioReview({ lessons }: { lessons: LessonItem[] }) {
  const [lessonId, setLessonId] = useState(lessons[0]?.id ?? '');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('todo');
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [autos, setAutos] = useState<Record<string, Auto>>({});
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [chain, setChain] = useState(false);
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  // 本次刚标过的条目留在列表里，不会因为筛选条件马上消失（否则来不及选问题类型）
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const noteRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => setVerdicts(load()), []);

  const lesson = lessons.find((l) => l.id === lessonId) ?? lessons[0];

  // 读每条音频旁边的 .json 质检记录：自动检查结果 + 版本指纹（重录后指纹会变）
  useEffect(() => {
    let alive = true;
    Promise.all(
      lesson.clips.map(async (c) => {
        try {
          const r = await fetch(c.src.replace(/\.m4a$/, '.json'));
          return [c.src, autoCheck(await r.json())] as const;
        } catch {
          return [c.src, { pass: true, why: [] }] as const;
        }
      }),
    ).then((pairs) => alive && setAutos((a) => ({ ...a, ...Object.fromEntries(pairs) })));
    return () => {
      alive = false;
    };
  }, [lesson]);

  const status = useCallback(
    (c: Clip) => {
      const v = verdicts[c.src];
      const a = autos[c.src];
      const stale = v && a?.sha && v.sha && v.sha !== a.sha;
      return { v: stale ? undefined : v, stale: !!stale, a };
    },
    [verdicts, autos],
  );

  const shown = useMemo(
    () =>
      lesson.clips.filter((c) => {
        if (touched.has(c.src)) return true;
        const s = status(c);
        if (filter === 'todo') return !s.v;
        if (filter === 'flag') return s.a && !s.a.pass;
        if (filter === 'bad') return s.v?.v === 'bad';
        return true;
      }),
    [lesson, filter, status, touched],
  );

  useEffect(() => {
    setCurrent(0);
    setChain(false);
    setTouched(new Set());
    audioRef.current?.pause();
  }, [lessonId, filter]);

  const save = (next: Record<string, Verdict>) => {
    setVerdicts(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  };

  const mark = (c: Clip, v: 'ok' | 'bad', patch: Partial<Verdict> = {}) => {
    const prev = verdicts[c.src];
    const keep = v === 'bad' && prev?.v === 'bad' ? prev : {};
    setTouched((t) => new Set(t).add(c.src));
    save({ ...verdicts, [c.src]: { ...keep, ...patch, v, sha: autos[c.src]?.sha } });
  };

  const pickType = (c: Clip, n: number) => {
    mark(c, 'bad', { type: n });
    setPicking(false);
    if (n === 5) setTimeout(() => noteRefs.current[c.src]?.focus(), 0);
  };

  const play = (i: number) => {
    const c = shown[i];
    if (!c || !audioRef.current) return;
    setCurrent(i);
    audioRef.current.src = c.src;
    audioRef.current.play();
    rowRefs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const c = shown[current];
      if (picking && c) {
        if (/^[1-5]$/.test(e.key)) {
          e.preventDefault();
          pickType(c, Number(e.key));
          return;
        }
        if (e.key === 'Escape') {
          setPicking(false);
          return;
        }
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (playing) audioRef.current?.pause();
        else play(current);
      } else if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        play(Math.min(current + 1, shown.length - 1));
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        play(Math.max(current - 1, 0));
      } else if (/^[1-5]$/.test(e.key) && c) {
        // 不标就是没问题；按 1～5 直接把当前这条标成对应的问题类型
        e.preventDefault();
        pickType(c, Number(e.key));
      } else if ((e.key === 'Backspace' || e.key === '0') && c && verdicts[c.src]?.v === 'bad') {
        mark(c, 'ok');
      } else if (e.key === 'r' && c) {
        play(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const badList = lessons.flatMap((l) =>
    l.clips
      .filter((c) => status(c).v?.v === 'bad')
      .map((c) => {
        const v = verdicts[c.src];
        const t = ISSUE_TYPES.find((x) => x.n === v?.type);
        const tag = t ? `[${t.n} ${t.label}] ` : '[未分类] ';
        return `${tag}第 ${l.number} 课（${l.id}）${c.kind}：${c.ja}${v?.note ? ` —— ${v.note}` : ''}`;
      }),
  );
  const doneCount = lesson.clips.filter((c) => status(c).v).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 pb-40 text-ink">
      <h1 className="font-display text-2xl font-bold">音频人耳确认</h1>
      <p className="mt-1 text-sm text-ink/60">
        <b>不标就是没问题</b>（听完自动记为已听）· 空格 播放/暂停 · ↓/J 下一条 · ↑/K 上一条 · R 重听 · 有问题直接按 <b>1～5</b> 选类型 · 标错了按 0 取消
      </p>

      <div className="sticky top-0 z-10 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-b border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur">
        <select
          className="rounded-xl border border-ink/15 bg-white px-3 py-2 text-sm font-semibold"
          value={lessonId}
          onChange={(e) => setLessonId(e.target.value)}
        >
          {lessons.map((l) => {
            const left = l.clips.filter((c) => !status(c).v).length;
            return (
              <option key={l.id} value={l.id}>
                {l.pending ? '待上线' : `第 ${l.number} 课`} {l.title}
                {left ? `（${left} 条没听）` : ' ✓'}
              </option>
            );
          })}
        </select>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === f.key ? 'bg-ink text-cream' : 'bg-white text-ink/70 ring-1 ring-ink/10'}`}
          >
            {f.label}
          </button>
        ))}
        <button
          onClick={() => {
            setChain(true);
            play(0);
          }}
          className="ml-auto rounded-full bg-coral px-4 py-1.5 text-xs font-bold text-white"
        >
          ▶ 从头连续播放
        </button>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-ink/55">
        {lesson.grammar} · 本课 {lesson.clips.length} 条，已确认 {doneCount} 条 · 当前筛选 {shown.length} 条
        <button
          onClick={() => {
            const next = { ...verdicts };
            for (const c of lesson.clips) {
              if (!status(c).v) next[c.src] = { v: 'ok', sha: autos[c.src]?.sha };
            }
            save(next);
          }}
          className="ml-auto rounded-full bg-white px-3 py-1 font-bold text-ink/60 ring-1 ring-ink/10"
        >
          以前听过了：本课没听的全部记为已听
        </button>
      </p>

      <ol className="mt-3 space-y-2">
        {shown.map((c, i) => {
          const s = status(c);
          const active = i === current;
          return (
            <li
              key={c.src}
              ref={(el) => {
                rowRefs.current[i] = el;
              }}
              onClick={() => play(i)}
              className={`cursor-pointer rounded-2xl border p-3 transition ${active ? 'border-coral bg-white ring-4 ring-coral/15' : 'border-ink/10 bg-white/70'} ${s.v?.v === 'ok' ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center gap-2 text-[11px] font-bold">
                <span className="rounded-full bg-ink/5 px-2 py-0.5 text-ink/60">{c.kind}</span>
                {s.a && !s.a.pass && (
                  <span className="rounded-full bg-peach px-2 py-0.5 text-coral">自动检查：{s.a.why.join('、')}</span>
                )}
                {s.stale && <span className="rounded-full bg-mint/40 px-2 py-0.5">重录过，请再听</span>}
                <span className="ml-auto flex gap-1">
                  {s.v?.v === 'ok' && <span className="self-center px-1 text-ink/40">已听</span>}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (s.v?.v === 'bad') {
                        mark(c, 'ok');
                        setPicking(false);
                      } else {
                        mark(c, 'bad');
                        setCurrent(i);
                        setPicking(true);
                      }
                    }}
                    title={s.v?.v === 'bad' ? '再点一次取消' : undefined}
                    className={`rounded-full px-2.5 py-1 ${s.v?.v === 'bad' ? 'bg-coral text-white' : 'bg-ink/5 text-ink/50'}`}
                  >
                    ✗ 有问题
                  </button>
                </span>
              </div>
              <p className="mt-2 text-lg font-semibold leading-7">{c.ja}</p>
              <p className="text-sm text-ink/55">{c.zh}</p>
              {s.v?.v === 'bad' && (
                <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-1.5">
                    {ISSUE_TYPES.map((t) => (
                      <button
                        key={t.n}
                        onClick={() => pickType(c, t.n)}
                        className={`rounded-full px-3 py-1 text-xs font-bold ${s.v?.type === t.n ? 'bg-coral text-white' : 'bg-peach text-coral'}`}
                      >
                        {t.n} {t.label}
                      </button>
                    ))}
                    {active && picking && <span className="self-center text-[11px] text-ink/50">按 1～5 选择，Esc 取消</span>}
                  </div>
                  {(s.v?.type === 5 || s.v?.note) && (
                    <input
                      ref={(el) => {
                        noteRefs.current[c.src] = el;
                      }}
                      defaultValue={verdicts[c.src]?.note ?? ''}
                      onBlur={(e) => mark(c, 'bad', { note: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      placeholder={s.v?.type === 5 ? '请写具体问题（例：把 네 读成了 내）' : '补充说明（可不填）'}
                      className="w-full rounded-xl border border-coral/40 bg-cream px-3 py-2 text-sm"
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="rounded-2xl bg-mint/25 p-4 text-sm font-semibold">这一课在当前筛选下没有要听的了 ✓</li>}
      </ol>

      <div className="fixed inset-x-0 bottom-0 border-t border-ink/10 bg-cream/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <span className="text-sm font-semibold">
            标了有问题的：{badList.length} 条
            {badList.some((b) => b.startsWith('[未分类]')) && <span className="ml-2 text-xs text-coral">有几条还没选问题类型</span>}
          </span>
          <button
            disabled={!badList.length}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`音频人耳确认结果：\n${badList.join('\n')}`);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {}
            }}
            className="ml-auto rounded-full bg-ink px-4 py-2 text-xs font-bold text-cream disabled:opacity-30"
          >
            {copied ? '已复制 ✓' : '复制结果，贴给 Claude'}
          </button>
        </div>
      </div>

      <audio
        ref={audioRef}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          // 听完一条、没标问题，就算「已听、没问题」
          const c = shown[current];
          if (c && !verdicts[c.src]) mark(c, 'ok');
          if (chain && current < shown.length - 1) setTimeout(() => play(current + 1), 500);
          else setChain(false);
        }}
      />
    </main>
  );
}
