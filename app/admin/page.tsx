import AuthShell, { primary, secondary } from '@/components/auth/shell';
import { getDb, now } from '@/lib/server/db';
import { requireAdmin } from './_guard';

export default async function AdminHome() {
  const admin = await requireAdmin();
  if (!admin) return <AuthShell title="管理后台" message="forbidden"><a href="/login?next=/admin" className={primary}>用管理员账号登录</a></AuthShell>;
  const db = await getDb();
  const count = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const week = now() - 7 * 86400;
  const stats = [
    ['注册用户', await count(`SELECT COUNT(*) n FROM users WHERE status != 'deleted'`)],
    ['近 7 天新注册', await count(`SELECT COUNT(*) n FROM users WHERE created_at > ${week}`)],
    ['已解锁全部课程', await count(`SELECT COUNT(DISTINCT user_id) n FROM entitlements WHERE kind = 'full_course'`)],
    ['未使用邀请码', await count(`SELECT COUNT(*) n FROM invite_codes WHERE used_by IS NULL AND revoked_at IS NULL`)],
    ['未验证邮箱', await count(`SELECT COUNT(*) n FROM users WHERE email_verified_at IS NULL AND status = 'active'`)],
  ] as const;
  const log = (await db.prepare('SELECT a.*, u.nickname FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY at DESC LIMIT 20').all<{ action: string; target: string | null; detail: string | null; at: number; nickname: string | null }>()).results ?? [];
  return (
    <AuthShell title="管理后台" eyebrow={`管理员 · ${admin.nickname}`} wide>
      <div className="flex flex-wrap gap-2">
        <a href="/admin/invites" className={secondary}>邀请码</a>
        <a href="/admin/users" className={secondary}>用户</a>
        <a href="/review" className={secondary}>音频人耳确认</a>
        <a href="/account" className={secondary}>我的账户</a>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-2xl border border-ink/10 bg-white/70 p-4">
            <p className="text-xs text-ink/60">{k}</p>
            <p className="mt-1 font-display text-2xl font-extrabold">{v}</p>
          </div>
        ))}
      </div>
      <h2 className="mt-8 font-display text-lg font-bold">最近操作</h2>
      <ul className="mt-2 divide-y divide-ink/10 rounded-2xl border border-ink/10 bg-white/70 text-xs">
        {log.map((l, i) => (
          <li key={i} className="flex flex-wrap gap-x-3 px-4 py-2">
            <span className="text-ink/50">{new Date(l.at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' })}</span>
            <span className="font-bold">{l.nickname ?? '—'}</span>
            <span>{l.action}</span>
            <span className="text-ink/60">{l.target}</span>
            {l.detail && <span className="text-ink/50">{l.detail}</span>}
          </li>
        ))}
        {!log.length && <li className="px-4 py-2 text-ink/60">还没有记录。</li>}
      </ul>
    </AuthShell>
  );
}
