import AuthShell, { field, primary, secondary, q, type Search } from '@/components/auth/shell';
import { STUDY_YEARS, formatDate, daysLeft } from '@/lib/server/auth';
import { getDb, now } from '@/lib/server/db';
import { requireAdmin } from '../_guard';

type Row = { id: string; email: string; nickname: string; role: string; status: string; email_verified_at: number | null; study_years: string | null; created_at: number; last_login_at: number | null; full: number; forever: number; expires_at: number | null };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  if (!admin) return <AuthShell title="用户" message="forbidden"><a href="/login?next=/admin/users" className={primary}>用管理员账号登录</a></AuthShell>;
  const search = q(sp, 'q').trim();
  const db = await getDb();
  const rows =
    (
      await db
        .prepare(
          `SELECT u.id, u.email, u.nickname, u.role, u.status, u.email_verified_at, u.study_years, u.created_at, u.last_login_at,
                  EXISTS(SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.kind = 'full_course' AND (e.expires_at IS NULL OR e.expires_at > ?)) AS full,
                  EXISTS(SELECT 1 FROM entitlements e WHERE e.user_id = u.id AND e.kind = 'full_course' AND e.expires_at IS NULL) AS forever,
                  (SELECT MAX(e.expires_at) FROM entitlements e WHERE e.user_id = u.id AND e.kind = 'full_course') AS expires_at
           FROM users u WHERE u.status != 'deleted' AND (? = '' OR u.email LIKE ? OR u.nickname LIKE ?)
           ORDER BY u.created_at DESC LIMIT 200`,
        )
        .bind(now(), search, `%${search}%`, `%${search}%`)
        .all<Row>()
    ).results ?? [];
  const fmt = (s: number | null) => (s ? new Date(s * 1000).toLocaleDateString('zh-CN', { timeZone: 'Asia/Tokyo' }) : '—');
  const Act = ({ id, action, text }: { id: string; action: string; text: string }) => (
    <form method="post" action="/api/admin/users" className="inline">
      <input type="hidden" name="user_id" value={id} />
      <input type="hidden" name="action" value={action} />
      <input type="hidden" name="q" value={search} />
      <button type="submit" className="mr-2 underline">{text}</button>
    </form>
  );
  return (
    <AuthShell title="用户" eyebrow="管理后台" message={q(sp, 'm')} wide>
      <div className="flex flex-wrap items-center gap-3">
        <a href="/admin" className={secondary}>← 后台首页</a>
        <form method="get" className="flex gap-2">
          <input name="q" defaultValue={search} placeholder="搜邮箱或昵称" className={`${field} mt-0 w-56`} />
          <button type="submit" className={secondary}>搜索</button>
        </form>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-ink/10 bg-white/70">
        <table className="w-full text-xs">
          <thead className="text-left text-ink/60">
            <tr>
              <th className="px-3 py-2">昵称</th>
              <th className="px-3 py-2">邮箱</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">年卡到期</th>
              <th className="px-3 py-2">学习历</th>
              <th className="px-3 py-2">注册</th>
              <th className="px-3 py-2">最近登录</th>
              <th className="px-3 py-2">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-ink/10">
                <td className="px-3 py-2 font-bold">
                  {r.nickname}
                  {r.role === 'admin' && <span className="ml-1 rounded-full bg-ink px-1.5 py-0.5 text-[10px] text-cream">管理员</span>}
                </td>
                <td className="px-3 py-2">{r.email}</td>
                <td className="px-3 py-2">
                  {r.status === 'banned' ? '已停用' : '正常'} · {r.email_verified_at ? '已验证' : '未验证'} · {r.full || r.role === 'admin' ? '全部课程' : '只能听对话'}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.role === 'admin' ? (
                    '—'
                  ) : r.forever ? (
                    '永久'
                  ) : r.expires_at ? (
                    r.expires_at <= now() ? (
                      <span className="font-bold text-coral">{formatDate(r.expires_at)}（已到期）</span>
                    ) : daysLeft(r.expires_at) <= 30 ? (
                      <span className="font-bold text-[#8a6d1f]">{formatDate(r.expires_at)}</span>
                    ) : (
                      formatDate(r.expires_at)
                    )
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-2">{STUDY_YEARS.find((s) => s.key === r.study_years)?.label ?? '—'}</td>
                <td className="px-3 py-2">{fmt(r.created_at)}</td>
                <td className="px-3 py-2">{fmt(r.last_login_at)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.id !== admin.id && r.role !== 'admin' && (
                    <>
                      {!r.email_verified_at && <Act id={r.id} action="verify" text="标为已验证" />}
                      <Act id={r.id} action="grant" text={r.full ? '送 1 年' : '手动开 1 年'} />
                      {r.full && <Act id={r.id} action="revoke_access" text="收回权限" />}
                      {r.status === 'banned' ? <Act id={r.id} action="unban" text="恢复" /> : <Act id={r.id} action="ban" text="停用" />}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={8} className="px-3 py-4 text-ink/60">没有用户。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AuthShell>
  );
}
