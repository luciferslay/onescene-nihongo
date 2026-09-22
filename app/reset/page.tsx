import AuthShell, { label, primary, q, type Search } from '@/components/auth/shell';
import PasswordField from '@/components/auth/password-field';

export default async function ResetPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const token = q(sp, 'token');
  return (
    <AuthShell title="设置新密码" eyebrow="重置密码" message={q(sp, 'm')}>
      {token ? (
        <form method="post" action="/api/auth/reset" className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <div>
            <label className={label}>新密码（至少 8 位）</label>
            <PasswordField name="password" autoComplete="new-password" />
          </div>
          <div>
            <label className={label}>再输一遍</label>
            <PasswordField name="password2" autoComplete="new-password" />
          </div>
          <button type="submit" className={primary}>保存新密码</button>
        </form>
      ) : (
        <p className="text-sm text-ink/70">链接不完整，请从邮件里重新点开，或 <a href="/forgot" className="underline">重新申请</a>。</p>
      )}
    </AuthShell>
  );
}
