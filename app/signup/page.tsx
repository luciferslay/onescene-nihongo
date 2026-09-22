import AuthShell, { field, label, primary, q, type Search } from '@/components/auth/shell';
import PasswordField from '@/components/auth/password-field';
import { GENDERS, STUDY_YEARS, currentUser } from '@/lib/server/auth';

export default async function SignupPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  if (await currentUser()) return <AuthShell title="你已经登录了"><a href="/account" className={primary}>去我的账户</a></AuthShell>;
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: thisYear - 12 - 1940 + 1 }, (_, i) => thisYear - 12 - i);
  return (
    <AuthShell title="注册" eyebrow="创建账号" message={q(sp, 'm')}>
      <form method="post" action="/api/auth/signup" className="space-y-4">
        <div>
          <label className={label}>邮箱</label>
          <input name="email" type="email" autoComplete="email" required defaultValue={q(sp, 'email')} className={field} />
        </div>
        <div>
          <label className={label}>密码（至少 8 位）</label>
          <PasswordField name="password" autoComplete="new-password" />
        </div>
        <div>
          <label className={label}>再输一遍密码</label>
          <PasswordField name="password2" autoComplete="new-password" />
        </div>
        <div>
          <label className={label}>站内昵称（2–12 字，中英韩文都可以）</label>
          <input name="nickname" required minLength={2} maxLength={12} defaultValue={q(sp, 'nickname')} className={field} />
        </div>
        <div>
          <label className={label}>邀请码（选填，有的话可以现在解锁全部课程）</label>
          <input name="invite" placeholder="JP-XXXX-XXXX" autoCapitalize="characters" className={field} />
        </div>
        <details className="rounded-xl border border-ink/10 bg-white/60 p-3">
          <summary className="cursor-pointer text-xs font-bold text-ink/70">更多资料（选填）</summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className={label}>日语学习历</label>
              <select name="study_years" defaultValue="" className={field}>
                <option value="">不填</option>
                {STUDY_YEARS.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>出生年</label>
              <select name="birth_year" defaultValue="" className={field}>
                <option value="">不填</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>性别</label>
              <select name="gender" defaultValue="" className={field}>
                <option value="">不填</option>
                {GENDERS.map((g) => (
                  <option key={g.key} value={g.key}>{g.label}</option>
                ))}
              </select>
            </div>
          </div>
        </details>
        <label className="flex items-start gap-2 text-xs text-ink/80">
          <input type="checkbox" name="terms" required className="mt-0.5" />
          <span>
            我已阅读并同意 <a href="/terms" className="underline">利用规约</a> 与 <a href="/privacy" className="underline">隐私政策</a>。
          </span>
        </label>
        <button type="submit" className={primary}>注册</button>
      </form>
      <p className="mt-6 text-center text-xs text-ink/60">
        已经有账号？ <a href="/login" className="font-bold underline">登录</a>
      </p>
    </AuthShell>
  );
}
