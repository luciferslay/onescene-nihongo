import AuthShell, { field, label, primary, secondary, q, type Search } from '@/components/auth/shell';
import PasswordField from '@/components/auth/password-field';
import { GENDERS, STUDY_YEARS, currentUser, daysLeft, formatDate, membershipOf } from '@/lib/server/auth';
import { maybeScanExpiryReminders } from '@/lib/server/reminders';

export default async function AccountPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user)
    return (
      <AuthShell title="请先登录" message="need_login">
        <a href="/login?next=/account" className={primary}>去登录</a>
      </AuthShell>
    );
  await maybeScanExpiryReminders();
  const card = await membershipOf(user);
  const soon = card.expiresAt !== null && card.full && daysLeft(card.expiresAt) <= 30;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 12 - 1940 + 1 }, (_, i) => thisYear - 12 - i);
  const box = 'rounded-2xl border border-ink/10 bg-white/70 p-4 sm:p-5';
  return (
    <AuthShell title={`你好，${user.nickname}`} eyebrow="我的账户" message={q(sp, 'm')} wide>
      <div className="grid gap-5 md:grid-cols-2">
        <section className={box}>
          <h2 className="font-display text-lg font-bold">课程权限</h2>
          {card.admin ? (
            <p className="mt-2 text-sm">
              <span className="rounded-full bg-mint/40 px-2 py-0.5 text-xs font-bold">已解锁全部课程</span>
              <span className="ml-2 rounded-full bg-ink px-2 py-0.5 text-xs font-bold text-cream">管理员</span>
            </p>
          ) : card.forever ? (
            <p className="mt-2 text-sm">
              <span className="rounded-full bg-mint/40 px-2 py-0.5 text-xs font-bold">永久解锁</span>
            </p>
          ) : card.full && card.expiresAt !== null ? (
            <>
              <p className="mt-2 text-sm">
                <span className="rounded-full bg-mint/40 px-2 py-0.5 text-xs font-bold">已解锁全部课程</span>
              </p>
              <p className="mt-2 text-sm">年卡有效期至 <strong>{formatDate(card.expiresAt)}</strong></p>
              {soon && (
                <p className="mt-2 rounded-xl bg-[#fdf3dd] px-3 py-2 text-sm font-semibold text-[#8a6d1f]">
                  还有 {daysLeft(card.expiresAt)} 天到期
                </p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-bold text-coral">续费：输入新的邀请码</summary>
                <p className="mt-2 text-xs text-ink/60">没到期时续费，新的一年从原到期日往后接着算，不会吃亏。</p>
                <form method="post" action="/api/account/invite" className="mt-2 flex gap-2">
                  <input name="code" placeholder="JP-XXXX-XXXX" autoCapitalize="characters" required className={`${field} mt-0 flex-1`} />
                  <button type="submit" className={`${primary} mt-0 w-auto px-5`}>续费</button>
                </form>
              </details>
            </>
          ) : card.expired && card.expiresAt !== null ? (
            <>
              <p className="mt-2 text-sm">
                年卡已于 <strong>{formatDate(card.expiresAt)}</strong> 到期，现在每一课只能看第 1 步（场景任务和对话）。
              </p>
              <p className="mt-1 text-sm text-ink/70">学习记录都还在，输入新的邀请码就能接着学。</p>
              <form method="post" action="/api/account/invite" className="mt-3 flex gap-2">
                <input name="code" placeholder="JP-XXXX-XXXX" autoCapitalize="characters" required className={`${field} mt-0 flex-1`} />
                <button type="submit" className={`${primary} mt-0 w-auto px-5`}>续费</button>
              </form>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-ink/70">现在每一课只能看第 1 步（场景任务和对话）。输入邀请码解锁全部内容（年卡，1 年有效）。</p>
              <form method="post" action="/api/account/invite" className="mt-3 flex gap-2">
                <input name="code" placeholder="JP-XXXX-XXXX" autoCapitalize="characters" required className={`${field} mt-0 flex-1`} />
                <button type="submit" className={`${primary} mt-0 w-auto px-5`}>解锁</button>
              </form>
            </>
          )}
          <p className="mt-3 text-xs text-ink/50">邮箱：{user.email}</p>
          {user.role === 'admin' && (
            <a href="/admin" className={`${secondary} mt-3`}>进入管理后台</a>
          )}
        </section>

        <section className={box}>
          <h2 className="font-display text-lg font-bold">资料</h2>
          <form method="post" action="/api/account/profile" className="mt-3 space-y-3">
            <div>
              <label className={label}>昵称</label>
              <input name="nickname" required minLength={2} maxLength={12} defaultValue={user.nickname} className={field} />
            </div>
            <div>
              <label className={label}>日语学习历</label>
              <select name="study_years" defaultValue={user.study_years ?? ''} className={field}>
                <option value="">不填</option>
                {STUDY_YEARS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={label}>出生年</label>
                <select name="birth_year" defaultValue={user.birth_year ?? ''} className={field}>
                  <option value="">不填</option>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>性别</label>
                <select name="gender" defaultValue={user.gender ?? ''} className={field}>
                  <option value="">不填</option>
                  {GENDERS.map((g) => (
                    <option key={g.key} value={g.key}>{g.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <button type="submit" className={secondary}>保存资料</button>
          </form>
        </section>

        <section className={box}>
          <h2 className="font-display text-lg font-bold">修改密码</h2>
          <form method="post" action="/api/account/password" className="mt-3 space-y-3">
            <div>
              <label className={label}>当前密码</label>
              <PasswordField name="current" autoComplete="current-password" minLength={1} />
            </div>
            <div>
              <label className={label}>新密码（至少 8 位）</label>
              <PasswordField name="password" autoComplete="new-password" />
            </div>
            <div>
              <label className={label}>再输一遍新密码</label>
              <PasswordField name="password2" autoComplete="new-password" />
            </div>
            <button type="submit" className={secondary}>修改密码</button>
          </form>
        </section>

        <section className={box}>
          <h2 className="font-display text-lg font-bold">退出与注销</h2>
          <form method="post" action="/api/auth/logout" className="mt-3">
            <button type="submit" className={secondary}>退出登录</button>
          </form>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-bold text-coral">注销账号</summary>
            <p className="mt-2 text-xs text-ink/60">注销后无法恢复；已解锁的课程权限也会一起失效。输入密码确认。</p>
            <form method="post" action="/api/account/delete" className="mt-2 flex gap-2">
              <input name="password" type="password" autoComplete="current-password" required placeholder="当前密码" className={`${field} mt-0 flex-1`} />
              <button type="submit" className="rounded-full bg-coral px-4 py-2 text-xs font-bold text-white">确认注销</button>
            </form>
          </details>
        </section>
      </div>
    </AuthShell>
  );
}
