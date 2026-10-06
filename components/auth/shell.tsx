import { SITE_MARK, SITE_NAME, SITE_TAGLINE } from '@/lib/site';
import type { ReactNode } from 'react';
import { MESSAGES } from '@/lib/server/http';
import { isDemoMail } from '@/lib/server/mail';
import { hasDb } from '@/lib/server/db';

export type Search = Record<string, string | string[] | undefined>;
export function q(sp: Search, key: string): string {
  const v = sp[key];
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** 会员相关页面共用的外壳：站名、提示条、演示模式提醒。 */
export default function AuthShell({
  title,
  eyebrow,
  message,
  wide,
  children,
}: {
  title: string;
  eyebrow?: string;
  message?: string;
  wide?: boolean;
  children: ReactNode;
}) {
  if (!hasDb()) {
    return (
      <main className="mx-auto min-h-screen max-w-md px-4 py-10 text-ink">
        <a href="/" className="font-display text-lg font-bold">{SITE_NAME}</a>
        <h1 className="mt-8 font-display text-2xl font-extrabold">会员功能尚未开通</h1>
        <p className="mt-3 text-sm text-ink/70">目前所有课程都可以直接学习，不需要登录。</p>
        <a href="/" className="mt-6 inline-block text-sm font-bold text-coral underline">返回主页</a>
      </main>
    );
  }
  const m = message ? MESSAGES[message] : undefined;
  const demo = isDemoMail();
  return (
    <main className={`mx-auto min-h-screen px-4 py-6 text-ink sm:py-10 ${wide ? 'max-w-5xl' : 'max-w-md'}`}>
      <a href="/" className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-ink text-lg font-black text-cream">{SITE_MARK}</span>
        <span>
          <span className="block font-display text-lg font-bold">{SITE_NAME}</span>
          <span className="block text-xs text-ink/55">{SITE_TAGLINE}</span>
        </span>
      </a>
      {demo && (
        <p className="mt-4 rounded-xl border border-dashed border-coral/50 bg-peach px-3 py-2 text-xs text-ink/80">
          演示模式：还没接邮件服务，所有「邮件」（验证链接、验证码）都存在站长用的
          <a href="/outbox" className="mx-1 font-bold underline">
            发件箱
          </a>
          里，暂时不会真的发到邮箱。
        </p>
      )}
      {eyebrow && <p className="eyebrow mt-8">{eyebrow}</p>}
      <h1 className="mt-2 font-display text-2xl font-extrabold sm:text-3xl">{title}</h1>
      {m && (
        <p
          role="status"
          className={`mt-4 rounded-xl px-3 py-2 text-sm font-semibold ${m.kind === 'ok' ? 'bg-mint/30' : 'bg-coral/15 text-coral'}`}
        >
          {m.text}
        </p>
      )}
      <div className="mt-6">{children}</div>
    </main>
  );
}

export const field = 'mt-1 w-full rounded-xl border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none focus:border-coral';
export const label = 'block text-xs font-bold text-ink/70';
export const primary = 'mt-2 flex w-full items-center justify-center rounded-full bg-coral px-6 py-3 text-sm font-bold text-white transition hover:bg-[#db6249]';
export const secondary = 'inline-flex items-center justify-center rounded-full border border-ink/15 bg-white px-4 py-2 text-xs font-bold hover:bg-cream';
