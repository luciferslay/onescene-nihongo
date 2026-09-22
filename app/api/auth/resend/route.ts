import { envVar } from '@/lib/server/db';
import { findUserByEmail, issueToken } from '@/lib/server/auth';
import { allow } from '@/lib/server/ratelimit';
import { sendMail } from '@/lib/server/mail';
import { appOrigin, readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/login', { m: 'bad_request' });
  const f = await readForm(req);
  const email = (f.email ?? '').trim().toLowerCase();
  if (!(await allow(`resend:${email}`, 3, 3600))) return redirect(req, '/login', { m: 'rate_limited', email });
  const user = await findUserByEmail(email);
  if (user && !user.email_verified_at) {
    const token = await issueToken(user.id, 'verify');
    const link = `${appOrigin(req, envVar('APP_ORIGIN'))}/api/auth/verify?token=${token}`;
    await sendMail(email, '【ワンシーンで学ぶ日本語】请验证你的邮箱', `你好 ${user.nickname}，\n\n点下面的链接完成邮箱验证（24 小时内有效）：\n${link}`);
  }
  return redirect(req, '/login', { m: 'verify_resent', email });
}
