'use client';

import { SITE_MARK, SITE_NAME, SITE_TAGLINE } from '@/lib/site';
import { checkRoleplay, type RoleplayCheck } from '@/lib/roleplay-check';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Lightbulb,
  Mic,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
} from 'lucide-react';
import {
  findLesson,
  getLesson,
  lessonNumber,
  lessons,
  type Lesson,
  type Word,
} from '@/lib/lessons';

function hashSeed(text: string) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 小测顺序：按课程固定打乱，没有词停在原位，相邻两题也不来自相邻的卡片。 */
function quizOrder(count: number, seed: number) {
  const random = randomFrom(seed);
  const base = Array.from({ length: count }, (_, index) => index);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const order = [...base];
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const staysPut = order.some((value, index) => value === index);
    const adjacent = order.some(
      (value, index) => index > 0 && Math.abs(value - order[index - 1]) === 1,
    );
    if (!staysPut && (!adjacent || count < 5)) return order;
  }
  return base.map((_, index) => (index + Math.floor(count / 2) + 1) % count);
}

/** 四个选项：正确答案 + 固定抽取的三个干扰项，位置每题都变。 */
function choicesFor(words: Word[], target: number, seed: number) {
  const random = randomFrom(seed);
  const pool = words
    .map((_, index) => index)
    .filter((index) => index !== target);
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = [target, ...pool.slice(0, 3)];
  for (let i = picked.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked.map((index) => words[index].ja);
}

function WordDrill({
  words,
  eyebrow,
  title,
  seed,
  prefix = '',
}: {
  words: Word[];
  eyebrow: string;
  title: string;
  seed: number;
  prefix?: string;
}) {
  const [phase, setPhase] = useState<'study' | 'quiz'>('study');
  const [cardIndex, setCardIndex] = useState(0);
  const [quizIndex, setQuizIndex] = useState(0);
  const [difficulty, setDifficulty] = useState<'easy' | 'advanced'>('easy');
  const [answer, setAnswer] = useState('');
  const [results, setResults] = useState<Record<number, boolean>>({});
  const order = useMemo(
    () => quizOrder(words.length, seed),
    [words.length, seed],
  );
  const target = order[quizIndex] ?? 0;
  const word = words[target];
  const options = useMemo(
    () => choicesFor(words, target, seed + quizIndex * 97),
    [words, target, seed, quizIndex],
  );
  const correct = answer.trim() === word.ja;
  const wrong = order.filter((index) => results[index] === false);
  const allAnswered = order.every((index) => results[index] !== undefined);

  function reset(next: 'study' | 'quiz') {
    setPhase(next);
    setCardIndex(0);
    setQuizIndex(0);
    setAnswer('');
    setResults({});
  }

  function keep() {
    if (answer.trim())
      setResults((prev) => ({ ...prev, [target]: answer.trim() === word.ja }));
  }

  function go(step: number) {
    keep();
    setQuizIndex((value) => value + step);
    setAnswer('');
  }

  return (
    <section className="bonus-section mt-5">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2 className="mt-2 font-display text-xl font-extrabold">{title}</h2>
      </div>

      {phase === 'study' && (
        <>
          <div className="mt-5">
            <WordCarousel
              words={words}
              index={cardIndex}
              setIndex={setCardIndex}
              prefix={prefix}
            />
          </div>
          <button onClick={() => reset('quiz')} className="compact-button mt-5">
            开始小测（{words.length} 题）
          </button>
        </>
      )}

      {phase === 'quiz' && (
        <div className="mt-6">
          <p className="carousel-counter">
            词汇小测 · {quizIndex + 1} / {words.length}
          </p>
          <div className="card-carousel">
            <button
              aria-label="上一题"
              className="side-nav side-nav-left"
              disabled={quizIndex === 0}
              onClick={() => go(-1)}
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="card-stack">
              <div className="quiz-card">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-bold leading-7">
                    {word.quiz.replace('___', '______')}
                  </h3>
                  <details className="difficulty-fold">
                    <summary>难度</summary>
                    <div>
                      <button
                        onClick={() => {
                          setDifficulty('easy');
                          setAnswer('');
                        }}
                        className={difficulty === 'easy' ? 'active' : ''}
                      >
                        简单
                      </button>
                      <button
                        onClick={() => {
                          setDifficulty('advanced');
                          setAnswer('');
                        }}
                        className={difficulty === 'advanced' ? 'active' : ''}
                      >
                        进阶
                      </button>
                    </div>
                  </details>
                </div>
                {difficulty === 'easy' ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {options.map((option) => (
                      <button
                        key={option}
                        onClick={() => {
                          setAnswer(option);
                          setResults((prev) => ({
                            ...prev,
                            [target]: option === word.ja,
                          }));
                        }}
                        className={`answer-card ${answer === option ? 'answer-card-selected' : ''}`}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                    onBlur={keep}
                    placeholder="填写空缺的日语单词"
                    className="quiz-input"
                  />
                )}
                {answer && (
                  <p className={correct ? 'success' : 'hint'}>
                    {correct ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <Lightbulb className="h-4 w-4" />
                    )}
                    {correct
                      ? '回答正确！'
                      : '再读一次语境，想想哪个词最合适。'}
                  </p>
                )}
              </div>
            </div>
            <button
              aria-label="下一题"
              className="side-nav side-nav-right"
              disabled={quizIndex === words.length - 1}
              onClick={() => go(1)}
            >
              <ArrowRight className="h-5 w-5" />
            </button>
          </div>
          {allAnswered && wrong.length > 0 && (
            <div className="mt-6 border-t border-ink/10 pt-5">
              <p className="text-sm font-bold text-ink/65">这几个再看一遍：</p>
              <ul className="mt-3 grid gap-2">
                {wrong.map((index) => (
                  <li key={words[index].ja} className="quiz-card">
                    <p className="font-bold">
                      {words[index].ja}
                      <span className="ml-2 text-sm font-normal text-ink/55">
                        {words[index].zh}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-ink/65">
                      {words[index].example}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {allAnswered && wrong.length === 0 && (
            <p className="success mt-6">
              <Check className="h-4 w-4" />
              全部答对了，这组词可以过了。
            </p>
          )}
          <div className="mt-5">
            <button
              onClick={() => reset('study')}
              className="text-sm font-bold text-ink/55"
            >
              回到单词卡
            </button>
          </div>
        </div>
      )}


    </section>
  );
}

/** 列点里用 **…** 标出的重点渲染成粗体。只认这一种标记，够用且不引入 markdown 依赖。 */
function emphasize(text: string) {
  return text.split('**').map((part, index) =>
    index % 2 === 1 ? <strong key={index}>{part}</strong> : part,
  );
}

/** 语法解说正文：有列点就渲染列点，没有就退回整段 note（sample 系逐课补齐中）。 */
function GrammarNoteBody({ lesson }: { lesson: Lesson }) {
  const points = lesson.grammar.points;
  return (
    <>
      {points && points.length > 0 ? (
        <ul className="grammar-points">
          {points.map((point) => (
            <li key={point}>{emphasize(point)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-7 text-ink/70">{lesson.grammar.note}</p>
      )}
      <p className="mt-4 border-t border-ink/10 pt-4 font-semibold">
        예: {lesson.grammar.example}
      </p>
    </>
  );
}

/** 姊妹课链接：意思相近或易混的语法互相串联。只渲染已注册的课。 */
function RelatedLessons({ lesson }: { lesson: Lesson }) {
  const items = (lesson.related ?? [])
    .map((item) => ({ ...item, target: getLesson(item.id) }))
    .filter((item) => item.target);
  if (items.length === 0) return null;
  return (
    <div className="mt-3 border-t border-white/20 pt-3">
      <p className="text-[11px] tracking-[.16em] text-white/65">
        姊妹课 · 对比着学
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`/lesson/${item.id}`}
              className="block rounded-2xl bg-white/10 px-3 py-2 text-[13px] transition hover:bg-white/20"
            >
              <span className="flex items-start justify-between gap-2 font-bold">
                <span>{item.target!.grammar.title}</span>
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
              </span>
              <span className="mt-0.5 block text-[11px] leading-[1.5] text-white/75">
                {item.note}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 完成页用的姊妹课入口（浅色版）：学完这一课之后最自然的"接着看哪一课"。 */
function RelatedLessonsLight({ lesson }: { lesson: Lesson }) {
  const items = (lesson.related ?? [])
    .map((item) => ({ ...item, target: getLesson(item.id) }))
    .filter((item) => item.target);
  if (items.length === 0) return null;
  return (
    <section className="bonus-section mt-8">
      <p className="eyebrow">姊妹课 · 对比着学</p>
      <h2 className="mt-2 font-display text-xl font-extrabold">
        意思相近的语法，接着看一课
      </h2>
      <ul className="mt-5 space-y-3">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`/lesson/${item.id}`}
              className="block rounded-2xl border border-ink/10 bg-cream/70 px-4 py-3 transition hover:border-coral hover:bg-cream"
            >
              <span className="flex items-start justify-between gap-3 font-bold">
                <span>{item.target!.grammar.title}</span>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-coral" />
              </span>
              <span className="mt-1 block text-sm leading-6 text-ink/65">
                {item.note}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LessonNav({ id }: { id: string }) {
  const current = lessons.findIndex((item) => item.id === id);
  const previous = current > 0 ? lessons[current - 1] : undefined;
  const next = current >= 0 ? lessons[current + 1] : undefined;
  const style =
    'rounded-full border border-ink/10 bg-white/70 px-3 py-1.5 text-xs font-semibold';
  return (
    <nav className="mx-auto mb-4 flex max-w-6xl flex-wrap items-center gap-2">
      <a href="/" className={style}>
        返回主页
      </a>
      {previous ? (
        <a href={`/lesson/${previous.id}`} className={style}>
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
          上一课
        </a>
      ) : (
        <span className={`${style} opacity-40`}>
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
          上一课
        </span>
      )}
      {next ? (
        <a href={`/lesson/${next.id}`} className={style}>
          下一课
          <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
        </a>
      ) : (
        <span className={`${style} opacity-40`}>
          下一课
          <ArrowRight className="ml-1 inline h-3.5 w-3.5" />
        </span>
      )}
    </nav>
  );
}

function WordCarousel({
  words,
  index,
  setIndex,
  prefix,
}: {
  words: Word[];
  index: number;
  setIndex: (value: number) => void;
  prefix: string;
}) {
  const word = words[index];
  return (
    <>
      <div className="carousel-counter">
        单词 {index + 1} / {words.length}
      </div>
      <div className="card-carousel">
        <button
          aria-label="上一个单词"
          className="side-nav side-nav-left"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="card-stack">
          <article className="vocab-card vocab-single">
            {/* 排版与课文对话一致：喇叭在左、内容在右。原来的「单词朗读／例句朗读」药丸按钮
                各要 120px，手机上 185px 的卡片放不下两个，会把单词和例句挤成竖排。 */}
            <div className="flex items-start gap-3">
              <button
                data-audio={word.termAudio}
                aria-label="朗读单词"
                className="voice-button voice-button-soft audio-trigger"
              >
                <Volume2 className="h-4 w-4" />
              </button>
              <div className="min-w-0 flex-1">
                <h3>{word.ja}</h3>
                <details className="translation-fold">
                  <summary>中文翻译</summary>
                  <p>{word.zh}</p>
                </details>
              </div>
            </div>
            <div className="mt-5 flex items-start gap-3 border-t border-ink/8 pt-5">
              <button
                data-audio={word.audio}
                aria-label="朗读例句"
                className="voice-button voice-button-soft audio-trigger"
              >
                <Volume2 className="h-4 w-4" />
              </button>
              <small className="min-w-0 flex-1">{word.example}</small>
            </div>
          </article>
        </div>
        <button
          aria-label={`${prefix}下一个单词`}
          className="side-nav side-nav-right"
          disabled={index === words.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </>
  );
}

/**
 * 事件代理：点到 .audio-trigger 就播它的 data-audio。
 * 必须定义在 LessonFlow 外面 —— 以前定义在里面，每次状态变化都会生成一个「新的组件类型」，
 * 整棵子树卸载重建，输入框每打一个字就失焦，日语输入法根本打不了字（Luna 2026-09-23 报）。
 */
function AudioScope({ children, onPlay }: { children: ReactNode; onPlay: (src: string) => void }) {
  return (
    <div
      onClick={(event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.audio-trigger');
        if (button?.dataset.audio) onPlay(button.dataset.audio);
      }}
    >
      {children}
    </div>
  );
}

export default function LessonPage({
  lessonId,
  locked = false,
  loggedIn = false,
  preview = false,
}: {
  lessonId: string;
  /** 没解锁：只能用第 1 步，之后换成解锁面板（门禁规则与韩语站一致，Luna 2026-09-23） */
  locked?: boolean;
  loggedIn?: boolean;
  /** 靠预览链接进来的访客：右上角显示「预览模式 · 只读」 */
  preview?: boolean;
}) {
  const lesson = findLesson(lessonId);
  if (!lesson) {
    return (
      <main className="min-h-screen px-4 py-8 sm:px-8">
        <section className="mx-auto max-w-xl rounded-[2rem] border border-ink/10 bg-white p-8 text-center">
          <h1 className="font-display text-2xl font-extrabold">找不到这节课</h1>
          <a
            href="/"
            className="mt-4 inline-block text-sm font-bold text-coral"
          >
            返回课程列表
          </a>
        </section>
      </main>
    );
  }
  return <LessonFlow lesson={lesson} locked={locked} loggedIn={loggedIn} preview={preview} />;
}

/** 第 1 步结束处的解锁面板（没用邀请码解锁的用户看到） */
function UnlockPanel({ lessonId, loggedIn }: { lessonId: string; loggedIn: boolean }) {
  return (
    <div className="rounded-2xl border border-coral/30 bg-peach p-5">
      <p className="eyebrow">会员内容</p>
      <h3 className="mt-2 font-display text-lg font-bold">第 2 步起需要解锁</h3>
      <p className="mt-1 text-sm text-ink/70">
        每一课的场景任务和对话都可以免费听；场景拆解、语法、换个说法、角色扮演和附加练习需要用邀请码解锁全部课程。
      </p>
      {loggedIn ? (
        <form method="post" action="/api/account/invite" className="mt-4 flex gap-2">
          <input type="hidden" name="next" value={`/lesson/${lessonId}`} />
          <input
            name="code"
            placeholder="邀请码 JP-XXXX-XXXX"
            autoCapitalize="characters"
            required
            className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-coral"
          />
          <button type="submit" className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white">
            解锁
          </button>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/signup" className="rounded-full bg-coral px-5 py-2.5 text-sm font-bold text-white">
            注册
          </a>
          <a
            href={`/login?next=/lesson/${lessonId}`}
            className="rounded-full border border-ink/15 bg-white px-5 py-2.5 text-sm font-bold"
          >
            已有账号，登录
          </a>
        </div>
      )}
      <p className="mt-3 text-xs text-ink/50">邀请码在付费后由站长发放。</p>
    </div>
  );
}

function LessonFlow({
  lesson,
  locked,
  loggedIn,
  preview,
}: {
  lesson: Lesson;
  locked: boolean;
  loggedIn: boolean;
  preview: boolean;
}) {
  const { dialogue, lessonWords, bonusWords, grammarTests } = lesson;
  const [step, setStep] = useState(0);
  const [played, setPlayed] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  /** 4/6：先读解说，点「开始作答」后解说收起，再在无解说状态下答题。 */
  const [probeOpen, setProbeOpen] = useState(false);
  const [probeIndex, setProbeIndex] = useState(0);
  const [probeAnswers, setProbeAnswers] = useState<Record<number, string>>({});
  const [practiceAnswers, setPracticeAnswers] = useState<
    Record<number, string>
  >({});
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<0.7 | 1>(1);
  const [output, setOutput] = useState('');
  const [sentenceChecks, setSentenceChecks] = useState<
    { label: string; pass: boolean }[] | null
  >(null);
  const [lessonWordIndex, setLessonWordIndex] = useState(0);
  /** 6/7 角色扮演：每一句「你」的转写文本与判定结果；listening = 正在录音的句子下标。 */
  const [spoken, setSpoken] = useState<Record<number, string>>({});
  const [roleplayChecks, setRoleplayChecks] = useState<Record<number, RoleplayCheck[]>>({});
  const [listening, setListening] = useState<number | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  /** 3/7 定型句的解说气泡：按节点开合。 */
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>({});
  const recognizer = useRef<{ stop: () => void } | null>(null);
  const activeAudio = useRef<HTMLAudioElement | null>(null);
  const dialogueRun = useRef(0);
  const [dialogueActive, setDialogueActive] = useState(false);
  const [dialogueProgress, setDialogueProgress] = useState(0);
  const [dialogueIndex, setDialogueIndex] = useState(0);
  /** 进课时预加载的六句音频：只用来暖浏览器缓存与拿时长，不直接拿去播。 */
  const dialogueAudios = useRef<HTMLAudioElement[] | null>(null);
  /** 当前这一轮真正在播的六个 Audio 对象（每轮新建，避免复用已 ended 的元素导致"再听一遍"空跑）。 */
  const runAudios = useRef<HTMLAudioElement[]>([]);
  const progressFrame = useRef<number | null>(null);
  const allPracticeDone = grammarTests.every(
    (test, index) => practiceAnswers[index] === test.correct,
  );
  /** 4/6 的题目：第 1 题是语法原型（考「这个语法是干嘛的」），之后是找错题（考「会不会用」）。 */
  const probes = useMemo(() => {
    const meaningChoice = lesson.meaning.choices.find(
      (choice) => choice.value === lesson.meaning.correct,
    );
    return [
      {
        question: lesson.meaning.question,
        sentence: null as string | null,
        fixed: null as string | null,
        choices: lesson.meaning.choices.map((choice) => choice.label),
        correct: meaningChoice ? meaningChoice.label : '',
        explain: lesson.meaning.success,
        zh: null as string | null,
      },
      ...(lesson.errorTests ?? []).map((test) => ({
        question: '下面这句哪里不对？',
        sentence: test.wrong,
        fixed: test.fixed,
        choices: test.choices,
        correct: test.correct,
        explain: test.explain,
        zh: test.zh,
      })),
    ];
  }, [lesson]);
  const allProbesDone = probes.every(
    (probe, index) => probeAnswers[index] === probe.correct,
  );
  const allRoleplayDone = lesson.scene.roleplay.every(
    (item) => roleplayChecks[item.line] !== undefined,
  );
  const canContinue = [
    played,
    answer === lesson.feeling.correct,
    true,
    allProbesDone,
    allPracticeDone,
    allRoleplayDone,
    true,
  ][step];
  const STEP_COUNT = 7;
  const title = useMemo(
    () =>
      [
        '场景任务・先听一遍',
        '场景理解',
        '场景拆解・定型句',
        '这个场景里的语法',
        '换个说法',
        '角色扮演',
        '必修完成',
      ][step],
    [step],
  );

  /** 6/7 角色扮演：用浏览器自带的语音识别（Chrome / Safari），转写后放进文本框，允许手改再检查。 */
  function startListening(lineIndex: number) {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setSpeechError('这个浏览器没有语音识别（Firefox 不支持），请用 Chrome 或 Safari；也可以直接在框里打字。');
      return;
    }
    recognizer.current?.stop();
    const rec = new Ctor();
    rec.lang = 'ja-JP';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      const text = Array.from(event.results)
        .map((r) => r[0]?.transcript ?? '')
        .join('');
      setSpoken((prev) => ({ ...prev, [lineIndex]: (prev[lineIndex] ? prev[lineIndex] + ' ' : '') + text }));
    };
    rec.onerror = (event) => {
      setSpeechError(
        event.error === 'not-allowed'
          ? '浏览器没拿到麦克风权限。'
          : `语音识别出错（${event.error}），可以直接在框里打字。`,
      );
      setListening(null);
    };
    rec.onend = () => setListening(null);
    recognizer.current = rec;
    setSpeechError(null);
    setListening(lineIndex);
    rec.start();
  }

  function stopListening() {
    recognizer.current?.stop();
    setListening(null);
  }

  function judgeLine(item: Lesson['scene']['roleplay'][number]) {
    const text = spoken[item.line] ?? '';
    setRoleplayChecks((prev) => ({ ...prev, [item.line]: checkRoleplay(text, lesson.scene, item) }));
  }

  async function playAudio(source: string) {
    activeAudio.current?.pause();
    const audio = new Audio(source);
    audio.playbackRate = playbackRate;
    audio.preservesPitch = true;
    activeAudio.current = audio;
    await audio.play().catch(() => undefined);
  }

  /** 句与句之间的固定间隔。文件自带的句末自然停顿约 0.37～0.49 秒，合计控制在 1 秒以内。 */
  const DIALOGUE_GAP_MS = 150;

  function getDialogueAudios() {
    if (!dialogueAudios.current) {
      dialogueAudios.current = dialogue.map((line) => {
        const audio = new Audio();
        audio.preload = 'auto';
        audio.preservesPitch = true;
        audio.src = line.audio;
        return audio;
      });
    }
    return dialogueAudios.current;
  }

  useEffect(() => {
    getDialogueAudios().forEach((audio) => audio.load());
    return () => {
      dialogueRun.current += 1;
      if (progressFrame.current) cancelAnimationFrame(progressFrame.current);
      runAudios.current.forEach((audio) => audio.pause());
      runAudios.current = [];
      dialogueAudios.current?.forEach((audio) => {
        audio.pause();
        audio.src = '';
      });
      dialogueAudios.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  /** 立刻中断正在播的整轮对话（重复点击播放、点「继续」离开本步、离开页面时都会用到）。 */
  function stopDialogue() {
    dialogueRun.current += 1;
    if (progressFrame.current) cancelAnimationFrame(progressFrame.current);
    activeAudio.current?.pause();
    runAudios.current.forEach((audio) => audio.pause());
    runAudios.current = [];
    setDialogueActive(false);
  }

  async function playDialogue() {
    // 每轮都新建 Audio 对象：复用上一轮已经 ended 的元素时，currentTime 归零与 play 之间会打架，
    // 结果是「再听一遍」瞬间空跑到底、一点声音都没有。文件已被预加载进浏览器缓存，新建不会带来等待。
    stopDialogue();
    const run = dialogueRun.current;
    const audios = dialogue.map((line) => {
      const audio = new Audio(line.audio);
      audio.preservesPitch = true;
      audio.playbackRate = playbackRate;
      return audio;
    });
    runAudios.current = audios;
    setDialogueActive(true);
    setDialogueProgress(0);
    setDialogueIndex(0);

    // 估算总时长：用预加载那一组已经拿到的 metadata，没拿到的用平均值兜底
    const raw = getDialogueAudios().map((audio) =>
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : 0,
    );
    const known = raw.filter((value) => value > 0);
    const fallback = known.length
      ? known.reduce((sum, value) => sum + value, 0) / known.length
      : 5;
    const spans = raw.map(
      (value) => (value > 0 ? value : fallback) / playbackRate,
    );
    const gap = DIALOGUE_GAP_MS / 1000;
    const total =
      spans.reduce((sum, value) => sum + value, 0) + gap * (audios.length - 1);

    let elapsed = 0;
    for (let index = 0; index < audios.length; index += 1) {
      if (run !== dialogueRun.current) return;
      const audio = audios[index];
      audio.playbackRate = playbackRate;
      activeAudio.current = audio;
      setDialogueIndex(index);
      const base = elapsed;
      const tick = () => {
        if (run !== dialogueRun.current) return;
        setDialogueProgress(
          Math.min(1, (base + audio.currentTime / playbackRate) / total),
        );
        progressFrame.current = requestAnimationFrame(tick);
      };
      await new Promise<void>((resolve) => {
        const finish = () => {
          audio.removeEventListener('ended', finish);
          audio.removeEventListener('error', finish);
          resolve();
        };
        audio.addEventListener('ended', finish);
        audio.addEventListener('error', finish);
        audio.play().catch(finish);
        tick();
      });
      if (progressFrame.current) cancelAnimationFrame(progressFrame.current);
      if (run !== dialogueRun.current) return;
      elapsed = base + spans[index];
      setDialogueProgress(Math.min(1, elapsed / total));
      if (index < audios.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, DIALOGUE_GAP_MS));
        if (run !== dialogueRun.current) return;
        elapsed += gap;
        setDialogueProgress(Math.min(1, elapsed / total));
      }
    }
    if (run !== dialogueRun.current) return;
    runAudios.current = [];
    setDialogueProgress(1);
    setDialogueActive(false);
    // 第一遍完整听完后就解锁「继续」，之后再听一遍也不会重新锁上（Luna：重听时可以随时点继续打断）。
    setPlayed(true);
  }

  function evaluateSentence() {
    const text = output.trim();
    const {
      marker,
      markerNoSpace,
      spacingLabel,
      displayName,
      meaningSide,
      meaningLabel,
    } = lesson.sentence;
    const markerMatch = new RegExp(marker).exec(text);
    const grammarAt = markerMatch ? markerMatch.index : -1;
    const markerEnd = markerMatch ? grammarAt + markerMatch[0].length : -1;
    const meaningPart =
      meaningSide === 'after'
        ? text.slice(Math.max(0, markerEnd))
        : text.slice(0, Math.max(0, grammarAt));
    setSentenceChecks([
      {
        label: '日语书写形式：没有夹杂拉丁字母或异常符号',
        pass: /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) && !/[A-Za-z]/.test(text),
      },
      {
        label: spacingLabel,
        pass:
          grammarAt >= 1 &&
          !new RegExp(markerNoSpace).test(text) &&
          !/\s{2,}/.test(text),
      },
      {
        label: `语法连接：${displayName} 前面接了正确的形态`,
        pass: grammarAt >= 1 && !new RegExp(`(ます|です|ました|でした)${marker}`).test(text),
      },
      {
        label: meaningLabel,
        pass: grammarAt >= 0 && /[\u3040-\u30ff\u4e00-\u9fff]{2,}/.test(meaningPart),
      },
      {
        label: '句末完整：不限语体，但需要完整结句',
        pass: /(です|ます|でした|ました|ません|でしょう|ましょう|ください|ない|た|だ|る|う|く|す|つ|ぬ|ぶ|む|ぐ|ね|よ|か|わ|ぞ|ん|い)[。.!?！？]?$/.test(text),
      },
    ]);
  }

  function SpeedControl() {
    return (
      <details className="speed-fold">
        <summary>变更语速</summary>
        <div className="speed-control mt-2">
          <button
            onClick={() => setPlaybackRate(1)}
            className={playbackRate === 1 ? 'speed-active' : ''}
          >
            正常
          </button>
          <button
            onClick={() => setPlaybackRate(0.7)}
            className={playbackRate === 0.7 ? 'speed-active' : ''}
          >
            慢速
          </button>
        </div>
      </details>
    );
  }

  function next() {
    if (locked && step === 0) return; // 没解锁：第 1 步之后不能继续
    if (step === 0) stopDialogue();
    if (step === 5) stopListening();
    if (step === STEP_COUNT - 1) setFinished(true);
    else setStep((value) => value + 1);
  }

  if (finished) {
    const seed = hashSeed(lesson.id);
    return (
      <AudioScope onPlay={playAudio}>
        <main className="min-h-screen px-4 py-8 sm:px-8">
          <LessonNav id={lesson.id} />
          <section className="mx-auto max-w-4xl rounded-[2rem] border border-ink/10 bg-white p-6 shadow-[0_24px_70px_rgba(31,42,55,.08)] sm:p-10">
            <div className="text-center">
              <Sparkles className="mx-auto h-12 w-12 text-coral" />
              <p className="mt-5 eyebrow">必修学习完成</p>
              <h1 className="mt-3 font-display text-3xl font-extrabold">
                以下是附加练习
              </h1>
            </div>
            <section className="bonus-section mt-8">
              <p className="eyebrow">附加练习 01</p>
              <h2 className="mt-2 font-display text-xl font-extrabold">
                {lesson.sentenceTitle}
              </h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {lesson.sentence.starters.map((starter) => (
                  <button
                    key={starter}
                    onClick={() => {
                      setOutput(starter.replace(/[…．.]+$/, ''));
                      setSentenceChecks(null);
                    }}
                    className="starter-chip"
                  >
                    {starter}
                  </button>
                ))}
              </div>
              <textarea
                value={output}
                onChange={(event) => {
                  setOutput(event.target.value);
                  setSentenceChecks(null);
                }}
                rows={3}
                placeholder={lesson.sentence.placeholder}
                className="mt-4 w-full resize-none rounded-2xl border border-ink/15 bg-cream/70 p-4 text-lg leading-8 outline-none focus:border-coral"
              />
              <button
                onClick={evaluateSentence}
                disabled={output.trim().length < 8}
                className="compact-button mt-3"
              >
                检查
              </button>
              {sentenceChecks && (
                <div className="check-list mt-4">
                  {sentenceChecks.map((item) => (
                    <p
                      key={item.label}
                      className={item.pass ? 'check-pass' : 'check-fail'}
                    >
                      {item.pass ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Lightbulb className="h-4 w-4" />
                      )}
                      {item.label}
                    </p>
                  ))}
                </div>
              )}
            </section>
            <WordDrill
              words={bonusWords}
              eyebrow="附加练习 02"
              title="附加单词：发音练习与小测"
              seed={seed}
            />
            <WordDrill
              words={lessonWords}
              eyebrow="附加练习 03"
              title="本节重要单词：回忆小测"
              seed={seed + 977}
            />
            <RelatedLessonsLight lesson={lesson} />
            <button
              onClick={() => {
                setFinished(false);
                setStep(0);
              }}
              className="mx-auto mt-8 flex items-center gap-2 text-sm font-bold text-ink/55"
            >
              <RotateCcw className="h-4 w-4" /> 重新学习必修部分
            </button>
          </section>
        </main>
      </AudioScope>
    );
  }

  const test = grammarTests[practiceIndex];
  const currentPractice = practiceAnswers[practiceIndex];
  return (
    <AudioScope onPlay={playAudio}>
      <main className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">
        <LessonNav id={lesson.id} />
        <header className="mx-auto flex max-w-6xl items-center justify-between">
          <a href="/" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-black text-cream">
              {SITE_MARK}
            </div>
            <div>
              <p className="font-display text-lg font-bold">{SITE_NAME}</p>
              <p className="text-xs text-ink/55">{SITE_TAGLINE}</p>
            </div>
          </a>
          <div className="flex items-center gap-2">
            {preview && (
              <span className="rounded-full bg-mint/60 px-3 py-2 text-xs font-bold">预览模式 · 只读</span>
            )}
            <div className="flex items-center gap-2 rounded-full border border-ink/10 bg-white/70 px-3 py-2 text-xs font-semibold">
              <Clock3 className="h-4 w-4 text-coral" /> 必修约 15 分钟
            </div>
          </div>
        </header>
        <section className="mx-auto mt-7 grid max-w-6xl gap-6 lg:grid-cols-[.82fr_1.18fr]">
          <aside className="relative flex min-h-[280px] flex-col overflow-hidden rounded-[2rem] bg-ink lg:min-h-[650px]">
            <Image
              src={lesson.image.src}
              alt={lesson.image.alt}
              fill
              priority
              className="object-cover opacity-90"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/75 to-ink/15" />
            <div className="relative mt-auto p-6 text-white sm:p-8">
              <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-ink">
                第 {lessonNumber(lesson.id)} 课
              </span>
              <span className="ml-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white">
                {lesson.scene.register}
              </span>
              <p className="mt-4 text-sm tracking-[.16em] text-white/65">
                本课场景
              </p>
              <h1 className="mt-2 font-display text-2xl font-extrabold">
                {lesson.listTitle}
              </h1>
              <p className="mt-3 text-sm text-white/75">{lesson.listSummary}</p>
              <p className="mt-4 border-t border-white/20 pt-4 text-xs tracking-[.16em] text-white/65">
                本课语法
              </p>
              <p className="mt-1 font-bold">{lesson.grammar.title}</p>
              <p className="mt-2 text-sm leading-7">
                <strong>例：</strong>
                {lesson.grammar.example}
              </p>
              <RelatedLessons lesson={lesson} />
            </div>
          </aside>
          <section className="flex min-h-[650px] flex-col rounded-[2rem] border border-ink/10 bg-white p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold tracking-[.12em] text-coral">
                {step + 1} / {STEP_COUNT} · {title}
              </span>
              <div className="flex gap-1.5">
                {Array.from({ length: STEP_COUNT }, (_, item) => item).map((item) => (
                  <span
                    key={item}
                    className={`h-1.5 rounded-full ${item <= step ? 'w-7 bg-coral' : 'w-3 bg-sand'}`}
                  />
                ))}
              </div>
            </div>
            <div className="flex flex-1 flex-col py-8">
              {step === 0 && (
                <div className="m-auto w-full max-w-md text-center">
                  <div className="mb-8 rounded-2xl border border-ink/10 bg-cream/60 p-5 text-left">
                    <p className="eyebrow">场景任务</p>
                    <p className="mt-2 leading-7">{lesson.scene.task}</p>
                    <p className="mt-3 text-xs text-ink/60">
                      A＝{lesson.scene.roles.A}　B＝{lesson.scene.roles.B}
                      <br />
                      语体：<strong>{lesson.scene.register}</strong>
                    </p>
                  </div>
                  <button onClick={playDialogue} className="primary-button">
                    <Play className="h-5 w-5 fill-current" />
                    {dialogueActive
                      ? '播放中…'
                      : played
                        ? '再听一遍'
                        : '播放音频'}
                  </button>
                  <div className="mt-7">
                    <div
                      className="h-1.5 w-full overflow-hidden rounded-full bg-sand"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(dialogueProgress * 100)}
                    >
                      <div
                        className="h-full rounded-full bg-coral transition-[width] duration-75"
                        style={{ width: `${dialogueProgress * 100}%` }}
                      />
                    </div>
                    <p className="mt-3 min-h-5 text-xs text-ink/55">
                      {dialogueActive
                        ? `第 ${dialogueIndex + 1} / ${dialogue.length} 句`
                        : played
                          ? '听完了，可以继续；也可以再听一遍'
                          : '整段听完才能继续'}
                    </p>
                  </div>
                </div>
              )}
              {step === 1 && (
                <div className="my-auto">
                  <p className="eyebrow">{lesson.feeling.eyebrow}</p>
                  <h2 className="question">{lesson.feeling.question}</h2>
                  <div className="mt-7 grid gap-3 sm:grid-cols-2">
                    {lesson.feeling.choices.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setAnswer(value)}
                        className={`answer-card ${answer === value ? 'answer-card-selected' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {answer && (
                    <p
                      className={
                        answer === lesson.feeling.correct ? 'success' : 'hint'
                      }
                    >
                      {answer === lesson.feeling.correct ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Lightbulb className="h-4 w-4" />
                      )}
                      {answer === lesson.feeling.correct
                        ? lesson.feeling.success
                        : lesson.feeling.hint}
                    </p>
                  )}
                </div>
              )}
              {step === 2 && (
                <div>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="eyebrow">场景拆解</p>
                      <h2 className="question">这个场合分三步，每步记一句</h2>
                    </div>
                    {SpeedControl()}
                  </div>
                  <div className="lesson-scroll mt-5">
                    {lesson.scene.nodes.map((node, nodeIndex) => {
                      return (
                        <section key={node.title} className="scene-node">
                          <p className="eyebrow">
                            第 {nodeIndex + 1} 步 · {node.title}
                          </p>
                          {node.lines.map((i) => {
                            const line = dialogue[i];
                            return (
                              <div
                                key={line.text}
                                className={`dialogue-row ${line.role === 'A' ? 'dialogue-a' : 'dialogue-b'}`}
                              >
                                <button
                                  onClick={() => playAudio(line.audio)}
                                  className="voice-button"
                                >
                                  <Volume2 className="h-4 w-4" />
                                </button>
                                <div>
                                  <p className="text-[11px] font-bold text-ink/45">
                                    {line.role}
                                  </p>
                                  <p className="mt-1 leading-7">
                                    {line.text.includes(node.phrase) ? (
                                      <>
                                        {line.text.split(node.phrase)[0]}
                                        <span
                                          className="phrase-mark"
                                          onClick={() =>
                                            setNoteOpen((prev) => ({ ...prev, [nodeIndex]: !prev[nodeIndex] }))
                                          }
                                        >
                                          {node.phrase}
                                        </span>
                                        <span
                                          className="phrase-bubble"
                                          onClick={() =>
                                            setNoteOpen((prev) => ({ ...prev, [nodeIndex]: !prev[nodeIndex] }))
                                          }
                                        >
                                          看解说
                                        </span>
                                        {line.text.split(node.phrase).slice(1).join(node.phrase)}
                                      </>
                                    ) : (
                                      line.text
                                    )}
                                  </p>
                                  {line.text.includes(node.phrase) && noteOpen[nodeIndex] && (
                                    <p className="phrase-note">{node.note}</p>
                                  )}
                                  <details className="translation-fold">
                                    <summary>中文翻译</summary>
                                    <p>{line.zh}</p>
                                  </details>
                                </div>
                              </div>
                            );
                          })}
                        </section>
                      );
                    })}
                    <div className="mt-7 border-t border-ink/10 pt-6">
                      <p className="eyebrow">核心词汇</p>
                      <h3 className="mt-2 text-lg font-extrabold">
                        本节课的重要单词
                      </h3>
                      <div className="mt-4">
                        <WordCarousel
                          words={lessonWords}
                          index={lessonWordIndex}
                          setIndex={setLessonWordIndex}
                          prefix=""
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {step === 3 && (
                <div className="my-auto">
                  <p className="eyebrow">{lesson.meaning.eyebrow}</p>
                  <h2 className="question">{lesson.grammar.title}</h2>
                  {probeOpen ? (
                    <>
                      <details className="note-fold mt-4">
                        <summary>再看一次解说</summary>
                        <div className="grammar-note mt-3">
                          <GrammarNoteBody lesson={lesson} />
                        </div>
                      </details>
                      <div className="mt-5">
                        <p className="carousel-counter">
                          理解语法结构 · {probeIndex + 1} / {probes.length}
                        </p>
                        <div className="card-carousel">
                          <button
                            aria-label="上一题"
                            className="side-nav side-nav-left"
                            disabled={probeIndex === 0}
                            onClick={() => setProbeIndex((i) => i - 1)}
                          >
                            <ArrowLeft className="h-5 w-5" />
                          </button>
                          <div className="card-stack">
                            <div className="test-card">
                              {probes[probeIndex].sentence && (
                                <p className="wrong-sentence">
                                  ✗ {probes[probeIndex].sentence}
                                </p>
                              )}
                              <h3 className="mt-3 font-bold leading-7">
                                {probes[probeIndex].question}
                              </h3>
                              <div className="mt-4 grid gap-2">
                                {probes[probeIndex].choices.map((option) => (
                                  <button
                                    key={option}
                                    onClick={() =>
                                      setProbeAnswers((prev) => ({
                                        ...prev,
                                        [probeIndex]: option,
                                      }))
                                    }
                                    className={`answer-card ${probeAnswers[probeIndex] === option ? 'answer-card-selected' : ''}`}
                                  >
                                    {option}
                                  </button>
                                ))}
                              </div>
                              {probeAnswers[probeIndex] && (
                                <>
                                  <p
                                    className={
                                      probeAnswers[probeIndex] ===
                                      probes[probeIndex].correct
                                        ? 'success'
                                        : 'hint'
                                    }
                                  >
                                    {probeAnswers[probeIndex] ===
                                    probes[probeIndex].correct ? (
                                      <Check className="h-4 w-4" />
                                    ) : (
                                      <Lightbulb className="h-4 w-4" />
                                    )}
                                    {probeAnswers[probeIndex] ===
                                    probes[probeIndex].correct
                                      ? probes[probeIndex].explain
                                      : lesson.meaning.hint}
                                  </p>
                                  {probeAnswers[probeIndex] ===
                                    probes[probeIndex].correct &&
                                    probes[probeIndex].fixed && (
                                      <div className="fixed-sentence">
                                        <p>✓ {probes[probeIndex].fixed}</p>
                                        {probes[probeIndex].zh && (
                                          <details className="translation-fold">
                                            <summary>中文翻译</summary>
                                            <p>{probes[probeIndex].zh}</p>
                                          </details>
                                        )}
                                      </div>
                                    )}
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            aria-label="下一题"
                            className="side-nav side-nav-right"
                            disabled={probeIndex === probes.length - 1}
                            onClick={() => setProbeIndex((i) => i + 1)}
                          >
                            <ArrowRight className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grammar-note mt-4">
                        <GrammarNoteBody lesson={lesson} />
                      </div>
                      <button
                        onClick={() => setProbeOpen(true)}
                        className="compact-button mt-5"
                      >
                        开始作答（{probes.length} 题）
                      </button>
                    </>
                  )}
                </div>
              )}
              {step === 4 && (
                <div className="my-auto">
                  <p className="eyebrow text-center">
                    换个说法 · {practiceIndex + 1} /{' '}
                    {grammarTests.length}
                  </p>
                  <div className="card-carousel mt-5">
                    <button
                      aria-label="上一句"
                      className="side-nav side-nav-left"
                      disabled={practiceIndex === 0}
                      onClick={() => setPracticeIndex((i) => i - 1)}
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <div className="card-stack">
                      <div className="test-card">
                        <h2 className="text-xl font-extrabold leading-snug">
                          {test.question}
                        </h2>
                        <p className="mt-5 text-lg font-semibold leading-8">
                          {test.blank}
                        </p>
                        <div className="mt-5 grid gap-3 sm:grid-cols-2">
                          {test.choices.map((option) => (
                            <button
                              key={option}
                              onClick={() =>
                                setPracticeAnswers((items) => ({
                                  ...items,
                                  [practiceIndex]: option,
                                }))
                              }
                              className={`answer-card ${currentPractice === option ? 'answer-card-selected' : ''}`}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                        {currentPractice && (
                          <p
                            className={
                              currentPractice === test.correct
                                ? 'success'
                                : 'hint'
                            }
                          >
                            {currentPractice === test.correct ? (
                              <Check className="h-4 w-4" />
                            ) : (
                              <Lightbulb className="h-4 w-4" />
                            )}
                            {currentPractice === test.correct ? (
                              <span>
                                <strong>{test.explain}</strong>
                                <br />
                                {test.full}
                              </span>
                            ) : (
                              lesson.grammarTestHint
                            )}
                          </p>
                        )}
                        {currentPractice === test.correct && (
                          <details className="translation-fold mt-3">
                            <summary>中文翻译</summary>
                            <p>{test.zh}</p>
                          </details>
                        )}
                      </div>
                    </div>
                    <button
                      aria-label="下一句"
                      className="side-nav side-nav-right"
                      disabled={practiceIndex === grammarTests.length - 1}
                      onClick={() => setPracticeIndex((i) => i + 1)}
                    >
                      <ArrowRight className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              )}
              {step === 5 && (
                <div>
                  <p className="eyebrow">角色扮演</p>
                  <h2 className="question">
                    你是 {lesson.scene.you}（{lesson.scene.roles[lesson.scene.you]}）
                  </h2>
                  <p className="mt-2 text-sm text-ink/60">
                    轮到你的句子：看中文提示，按麦克风说日语（也可以打字），检查后再听原句对比。原句只是参考说法之一，不是标准答案。
                  </p>
                  <div className="lesson-scroll mt-5">
                    {dialogue.map((line, i) => {
                      const mine = line.role === lesson.scene.you;
                      const item = lesson.scene.roleplay.find((r) => r.line === i);
                      if (!mine || !item) {
                        return (
                          <div
                            key={line.text}
                            className={`dialogue-row ${line.role === 'A' ? 'dialogue-a' : 'dialogue-b'}`}
                          >
                            <button onClick={() => playAudio(line.audio)} className="voice-button">
                              <Volume2 className="h-4 w-4" />
                            </button>
                            <div>
                              <p className="text-[11px] font-bold text-ink/45">{line.role}</p>
                              <p className="mt-1 leading-7">{line.text}</p>
                            </div>
                          </div>
                        );
                      }
                      const checks = roleplayChecks[i];
                      return (
                        <div key={line.text} className="roleplay-card">
                          <p className="text-[11px] font-bold text-coral">你（{line.role}）</p>
                          <p className="mt-1 leading-7">{line.zh}</p>
                          <p className="mt-1 text-sm text-ink/55">句首提示：{item.hint}</p>
                          <div className="mt-3 flex gap-2">
                            <button
                              onClick={() => (listening === i ? stopListening() : startListening(i))}
                              className={`compact-button ${listening === i ? 'compact-button-active' : ''}`}
                            >
                              <Mic className="h-4 w-4" /> {listening === i ? '录音中…点击停止' : '按下说话'}
                            </button>
                            <button onClick={() => judgeLine(item)} className="compact-button" disabled={!spoken[i]?.trim()}>
                              检查
                            </button>
                          </div>
                          <textarea
                            className="sentence-input mt-3"
                            rows={2}
                            placeholder="转写结果会出现在这里，也可以手动输入"
                            value={spoken[i] ?? ''}
                            onChange={(event) => setSpoken((prev) => ({ ...prev, [i]: event.target.value }))}
                          />
                          {checks && (
                            <ul className="check-list mt-3">
                              {checks.map((c, k) => (
                                <li key={k} className={c.pass ? 'check-pass' : 'check-fail'}>
                                  {c.pass ? <Check className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
                                  <span>
                                    {c.label}
                                    {!c.pass && c.hint ? ` —— ${c.hint}` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {checks && (
                            <div className="mt-3">
                              <button
                                onClick={() => {
                                  setRevealed((prev) => ({ ...prev, [i]: true }));
                                  playAudio(line.audio);
                                }}
                                className="compact-button"
                              >
                                <Volume2 className="h-4 w-4" /> 听原句对比
                              </button>
                              {revealed[i] && <p className="mt-2 leading-7">{line.text}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {speechError && <p className="hint mt-3">{speechError}</p>}
                  </div>
                </div>
              )}
              {step === 6 && (
                <div className="m-auto text-center">
                  <Check className="mx-auto h-14 w-14 text-mint" />
                  <h2 className="mt-6 font-display text-2xl font-extrabold">
                    必修部分完成！
                  </h2>
                  <p className="mt-3 text-sm text-ink/60">{lesson.scene.task}</p>
                </div>
              )}
            </div>
            {step === 0 && locked ? (
              <footer className="first-step-footer flex-col items-stretch">
                {SpeedControl()}
                <div className="mt-4">
                  <UnlockPanel lessonId={lesson.id} loggedIn={loggedIn} />
                </div>
              </footer>
            ) : step === 0 ? (
              <footer className="first-step-footer">
                {SpeedControl()}
                <button
                  onClick={next}
                  disabled={!canContinue}
                  className="next-button"
                >
                  继续 <ArrowRight className="h-4 w-4" />
                </button>
              </footer>
            ) : (
              <footer className="flex items-center gap-3 border-t border-ink/8 pt-5">
                <button
                  onClick={() => setStep((value) => Math.max(0, value - 1))}
                  className="secondary-button"
                >
                  <ArrowLeft className="h-4 w-4" /> 上一步
                </button>
                <button
                  onClick={next}
                  disabled={!canContinue}
                  className="next-button"
                >
                  {step === STEP_COUNT - 1 ? '点击查看附加练习' : '继续'}{' '}
                  {step === STEP_COUNT - 1 ? (
                    <Sparkles className="h-4 w-4" />
                  ) : (
                    <ArrowRight className="h-4 w-4" />
                  )}
                </button>
              </footer>
            )}
          </section>
        </section>
      </main>
    </AudioScope>
  );
}

/** 浏览器语音识别的最小类型（TS 自带的 lib.dom 没有它）。 */
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
