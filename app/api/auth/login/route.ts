import { verifyPassword } from '@/lib/server/crypto';
import { createSession, findUserByEmail, isAdminEmail, issueOtp, sessionCookie, OTP_COOKIE } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { allow, clientIp } from '@/lib/server/ratelimit';
import { sendMail } from '@/lib/server/mail';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/login', { m: 'bad_request' });
  const f = await readForm(req);
  const email = (f.email ?? '').trim().toLowerCase();
  const next = f.next?.startsWith('/') && !f.next.startsWith('//') ? f.next : '/';
  const back = (m: string) => redirect(req, '/login', { m, email, next });

  if (!(await allow(`login:ip:${clientIp(req)}`, 20, 900))) return back('rate_limited');
  if (!(await allow(`login:email:${email}`, 6, 900))) return back('rate_limited');

  const user = await findUserByEmail(email);
  const ok = user ? await verifyPassword(f.password ?? '', user.password_hash) : false;
  if (!user || !ok) return back('login_failed');
  if (user.status === 'banned') return back('banned');
  if (user.status !== 'active') return back('login_failed');
  if (!user.email_verified_at) return back('not_verified');

  // 管理员邮箱名单是活的：名单里的人登录时自动升为 admin，移出名单则降回 user。
  const shouldBeAdmin = isAdminEmail(email);
  if ((user.role === 'admin') !== shouldBeAdmin) {
    const db = await getDb();
    await db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(shouldBeAdmin ? 'admin' : 'user', user.id).run();
    user.role = shouldBeAdmin ? 'admin' : 'user';
  }

  const remember = f.remember === 'on';

  if (user.role === 'admin') {
    // 管理员第二步：邮箱验证码
    const { challenge, code } = await issueOtp(user.id);
    await sendMail(email, '【ワンシーンで学ぶ日本語】管理员登录验证码', `你的登录验证码是：${code}\n\n10 分钟内有效。如果不是你本人在登录，请立刻修改密码。`);
    const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
    return redirect(
      req,
      '/login/otp',
      { m: 'otp_sent', next },
      { 'Set-Cookie': `${OTP_COOKIE}=${challenge}${remember ? '.r' : ''}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure}` },
    );
  }

  const s = await createSession(user.id, remember, req);
  return redirect(req, next, undefined, { 'Set-Cookie': sessionCookie(s.token, s.maxAge, req) });
}
