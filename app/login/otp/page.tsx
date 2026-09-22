import AuthShell, { field, label, primary, q, type Search } from '@/components/auth/shell';

export default async function OtpPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="管理员验证" eyebrow="第二步" message={q(sp, 'm')}>
      <p className="text-sm text-ink/70">这是管理员账号，为了安全需要再输一次邮箱里收到的 6 位验证码。</p>
      <form method="post" action="/api/auth/otp" className="mt-4 space-y-4">
        <input type="hidden" name="next" value={q(sp, 'next') || '/admin'} />
        <div>
          <label className={label}>验证码</label>
          <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" required className={`${field} text-center text-2xl tracking-[.5em]`} />
        </div>
        <button type="submit" className={primary}>确认</button>
      </form>
    </AuthShell>
  );
}
