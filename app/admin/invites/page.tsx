import AuthShell, { field, label, primary, secondary, q, type Search } from '@/components/auth/shell';
import { getDb, now } from '@/lib/server/db';
import { requireAdmin } from '../_guard';

type Row = { code: string; note: string | null; created_at: number; expires_at: number | null; used_by: string | null; used_at: number | null; revoked_at: number | null; nickname: string | null; email: string | null };

export default async function InvitesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const admin = await requireAdmin();
  if (!admin) return <AuthShell title="邀请码" message="forbidden"><a href="/login?next=/admin/invites" className={primary}>用管理员账号登录</a></AuthShell>;
  const db = await getDb();
  const rows = (await db.prepare('SELECT c.*, u.nickname, u.email FROM invite_codes c LEFT JOIN users u ON u.id = c.used_by ORDER BY c.created_at DESC LIMIT 200').all<Row>()).results ?? [];
  const created = q(sp, 'created').split(',').filter(Boolean);
  const t = now();
  const fmt = (s: number | null) => (s ? new Date(s * 1000).toLocaleDateString('zh-CN', { timeZone: 'Asia/Tokyo' }) : '—');
  const state = (r: Row) => (r.used_by ? '已使用' : r.revoked_at ? '已作废' : r.expires_at && r.expires_at < t ? '已过期' : '可用');
  return (
    <AuthShell title="邀请码" eyebrow="管理后台" message={q(sp, 'm')} wide>
      <a href="/admin" className={secondary}>← 后台首页</a>
      <form method="post" action="/api/admin/invites" className="mt-4 grid gap-3 rounded-2xl border border-ink/10 bg-white/70 p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
        <div>
          <label className={label}>备注（给谁、怎么付的）</label>
          <input name="note" placeholder="例：9月 PayPay 张三" className={field} />
        </div>
        <div>
          <label className={label}>数量</label>
          <input name="count" type="number" min={1} max={50} defaultValue={1} className={`${field} w-20`} />
        </div>
        <div>
          <label className={label}>几天内要用掉（0 = 不限）</label>
          <input name="days" type="number" min={0} defaultValue={30} className={`${field} w-24`} />
        </div>
        <button type="submit" className={`${primary} mt-0 w-auto`}>生成</button>
      </form>
      {created.length > 0 && (
        <div className="mt-4 rounded-2xl bg-mint/25 p-4">
          <p className="text-xs font-bold">刚生成的邀请码（复制发给用户）：</p>
          <pre className="mt-2 select-all font-mono text-lg font-bold">{created.join('\n')}</pre>
        </div>
      )}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-ink/10 bg-white/70">
        <table className="w-full text-xs">
          <thead className="text-left text-ink/60">
            <tr>
              <th className="px-3 py-2">邀请码</th>
              <th className="px-3 py-2">状态</th>
              <th className="px-3 py-2">备注</th>
              <th className="px-3 py-2">生成</th>
              <th className="px-3 py-2">有效至</th>
              <th className="px-3 py-2">使用者</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.code} className="border-t border-ink/10">
                <td className="px-3 py-2 font-mono font-bold">{r.code}</td>
                <td className="px-3 py-2">{state(r)}</td>
                <td className="px-3 py-2">{r.note ?? ''}</td>
                <td className="px-3 py-2">{fmt(r.created_at)}</td>
                <td className="px-3 py-2">{r.expires_at ? fmt(r.expires_at) : '不限'}</td>
                <td className="px-3 py-2">{r.nickname ? `${r.nickname}（${r.email}）· ${fmt(r.used_at)}` : ''}</td>
                <td className="px-3 py-2">
                  {state(r) === '可用' && (
                    <form method="post" action="/api/admin/invites">
                      <input type="hidden" name="action" value="revoke" />
                      <input type="hidden" name="code" value={r.code} />
                      <button type="submit" className="text-coral underline">作废</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={7} className="px-3 py-4 text-ink/60">还没有邀请码。</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </AuthShell>
  );
}
