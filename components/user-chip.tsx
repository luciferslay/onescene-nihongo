import { currentAccess } from '@/lib/server/access';

/** 首页右上角：未登录显示「登录 / 注册」，登录后显示昵称（点进我的账户）。 */
export default async function UserChip() {
  const { user, full, preview } = await currentAccess();
  if (preview)
    return (
      <div className="flex items-center gap-2 text-xs font-semibold">
        <span className="rounded-full bg-mint/60 px-3 py-2">预览模式 · 只读</span>
        <a href="/preview?exit=1" className="rounded-full border border-ink/10 bg-white/70 px-3 py-2 hover:bg-white">退出</a>
      </div>
    );
  if (!user)
    return (
      <div className="flex items-center gap-2 text-xs font-semibold">
        <a href="/login" className="rounded-full border border-ink/10 bg-white/70 px-3 py-2 hover:bg-white">登录</a>
        <a href="/signup" className="rounded-full bg-ink px-3 py-2 text-cream hover:bg-ink/90">注册</a>
      </div>
    );
  return (
    <a href="/account" className="flex items-center gap-2 rounded-full border border-ink/10 bg-white/70 px-3 py-2 text-xs font-semibold hover:bg-white">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-coral text-[11px] font-black text-white">{Array.from(user.nickname)[0]}</span>
      {user.nickname}
      {full && <span className="rounded-full bg-mint/60 px-2 py-0.5 text-[10px] font-bold">已解锁</span>}
    </a>
  );
}
