import Image from 'next/image';
import { ArrowRight, Clock3 } from 'lucide-react';
import { getLesson, lessons } from '@/lib/lessons';
import { SITE_MARK, SITE_NAME, SITE_TAGLINE } from '@/lib/site';
import UserChip from '@/components/user-chip';
import { currentAccess } from '@/lib/server/access';

export default async function Home() {
  const access = await currentAccess();
  return (
    <main className="min-h-screen px-4 py-5 sm:px-8 sm:py-8">
      <header className="mx-auto flex max-w-6xl items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-black text-cream">
            {SITE_MARK}
          </div>
          <div>
            <p className="font-display text-lg font-bold">{SITE_NAME}</p>
            <p className="text-xs text-ink/55">{SITE_TAGLINE}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-ink/10 bg-white/70 px-3 py-2 text-xs font-semibold sm:flex">
            <Clock3 className="h-4 w-4 text-coral" /> 每课必修约 15 分钟
          </div>
          <UserChip />
        </div>
      </header>
      <section className="mx-auto mt-7 max-w-6xl">
        <p className="eyebrow">课程列表</p>
        <h1 className="mt-2 font-display text-3xl font-extrabold">
          选一个场景开始
        </h1>
        {!access.full && (
          <p className="mt-2 text-sm text-ink/60">每一课的第 1 步（场景任务和对话）都可以免费听；之后的讲解、练习和单词需要用邀请码解锁。</p>
        )}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {lessons.map((lesson, index) => (
            <a
              key={lesson.id}
              href={`/lesson/${lesson.id}`}
              className="group relative block min-h-[320px] overflow-hidden rounded-[2rem] bg-ink shadow-[0_24px_70px_rgba(31,42,55,.08)] transition hover:-translate-y-1"
            >
              <Image
                src={lesson.image.src}
                alt={lesson.image.alt}
                fill
                priority={index === 0}
                className="object-cover opacity-90 transition group-hover:scale-[1.02]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/30 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-8">
                <span className="rounded-full bg-mint px-3 py-1 text-xs font-bold text-ink">
                  第 {index + 1} 课
                </span>
                {!access.full && (
                  <span className="ml-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white">对话免费听</span>
                )}
                {lesson.related?.some((item) => getLesson(item.id)) && (
                  <span className="ml-2 rounded-full bg-white/20 px-3 py-1 text-xs font-bold text-white">
                    有姊妹课
                  </span>
                )}
                <p className="mt-4 text-sm tracking-[.16em] text-white/65">
                  今日の文法
                </p>
                <h2 className="mt-2 font-display text-2xl font-extrabold">
                  {lesson.grammar.title}
                </h2>
                <p className="mt-2 text-sm text-white/75">
                  {lesson.listSummary}
                </p>
                <p className="mt-4 flex items-center gap-2 text-sm font-bold">
                  开始学习 <ArrowRight className="h-4 w-4" />
                </p>
              </div>
            </a>
          ))}
        </div>
      </section>
    </main>
  );
}
