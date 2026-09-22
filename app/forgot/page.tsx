import AuthShell, { field, label, primary, q, type Search } from '@/components/auth/shell';

export default async function ForgotPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="找回密码" eyebrow="忘记密码" message={q(sp, 'm')}>
      <p className="text-sm text-ink/70">输入注册邮箱，我们会发一封带重置链接的邮件。</p>
      <form method="post" action="/api/auth/forgot" className="mt-4 space-y-4">
        <div>
          <label className={label}>邮箱</label>
          <input name="email" type="email" autoComplete="email" required className={field} />
        </div>
        <button type="submit" className={primary}>发送重置邮件</button>
      </form>
      <p className="mt-6 text-center text-xs text-ink/60"><a href="/login" className="underline">返回登录</a></p>
    </AuthShell>
  );
}
