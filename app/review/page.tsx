import AudioReview from '@/components/audio-review';
import { lessons, pendingLessons } from '@/lib/lessons';
import { SITE_NAME } from '@/lib/site';

export const metadata = { title: `音频人耳确认 · ${SITE_NAME}`, robots: { index: false } };

/** 音频人耳确认页（Luna 2026-09-21）：不在首页露出，直接访问 /review。 */
export default function Page() {
  const all = [...lessons, ...pendingLessons].map((lesson, i) => ({
    id: lesson.id,
    number: i + 1,
    pending: i >= lessons.length,
    title: lesson.listTitle,
    grammar: lesson.grammar.title,
    clips: [
      ...lesson.dialogue.map((d, k) => ({
        kind: `对话 ${k + 1}（${d.role}）`,
        ja: d.text,
        zh: d.zh,
        src: d.audio,
      })),
      ...lesson.lessonWords.flatMap((w) => [
        { kind: '本课单词', ja: w.ja, zh: w.zh, src: w.termAudio },
        { kind: '本课例句', ja: w.example, zh: w.ja, src: w.audio },
      ]),
      ...lesson.bonusWords.flatMap((w) => [
        { kind: '附加单词', ja: w.ja, zh: w.zh, src: w.termAudio },
        { kind: '附加例句', ja: w.example, zh: w.ja, src: w.audio },
      ]),
    ],
  }));
  return <AudioReview lessons={all} />;
}
