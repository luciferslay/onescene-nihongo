import AuthShell, { field, label, primary, q, type Search } from '@/components/auth/shell';
import PasswordField from '@/components/auth/password-field';
import { currentUser } from '@/lib/server/auth';

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  if (await currentUser()) return <AuthShell title="你已经登录了"><a href="/account" className={primary}>去我的账户</a></AuthShell>;
  const m = q(sp, 'm');
  const email = q(sp, 'email');
  const next = q(sp, 'next') || '/';
  const inviteNote = q(sp, 'invite');
  return (
    <AuthShell title="登录" eyebrow="欢迎回来" message={m}>
      {inviteNote && inviteNote !== 'ok' && (
        <p className="mb-4 rounded-xl bg-coral/15 px-3 py-2 text-xs font-semibold text-coral">注册成功，但邀请码没兑换成功（{inviteNote === 'used' ? '已被使用' : inviteNote === 'expired' ? '已过期' : inviteNote === 'revoked' ? '已作废' : '不存在'}），登录后可在「我的账户」再试。</p>
      )}
      <form method="post" action="/api/auth/login" className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div>
          <label className={label}>邮箱</label>
          <input name="email" type="email" autoComplete="email" required defaultValue={email} className={field} />
        </div>
        <div>
          <label className={label}>密码</label>
          <PasswordField name="password" autoComplete="current-password" minLength={1} />
        </div>
        <label className="flex items-center gap-2 text-xs text-ink/80">
          <input type="checkbox" name="remember" /> 记住我（30 天内不用重新登录）
        </label>
        <button type="submit" className={primary}>登录</button>
      </form>
      {m === 'not_verified' && (
        <form method="post" action="/api/auth/resend" className="mt-4 text-center">
          <input type="hidden" name="email" value={email} />
          <button type="submit" className="text-xs font-bold underline">重新发送验证邮件</button>
        </form>
      )}
      <p className="mt-6 flex justify-between text-xs text-ink/60">
        <a href="/forgot" className="underline">忘记密码</a>
        <span>
          还没账号？ <a href="/signup" className="font-bold underline">注册</a>
        </span>
      </p>
    </AuthShell>
  );
}
