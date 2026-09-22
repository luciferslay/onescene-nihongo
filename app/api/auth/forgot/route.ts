import { envVar } from '@/lib/server/db';
import { findUserByEmail, issueToken } from '@/lib/server/auth';
import { allow, clientIp } from '@/lib/server/ratelimit';
import { sendMail } from '@/lib/server/mail';
import { appOrigin, readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/forgot', { m: 'bad_request' });
  const f = await readForm(req);
  const email = (f.email ?? '').trim().toLowerCase();
  if (!(await allow(`forgot:${clientIp(req)}`, 5, 3600)) || !(await allow(`forgot:${email}`, 3, 3600)))
    return redirect(req, '/forgot', { m: 'rate_limited' });
  const user = await findUserByEmail(email);
  if (user && user.status === 'active') {
    const token = await issueToken(user.id, 'reset');
    const link = `${appOrigin(req, envVar('APP_ORIGIN'))}/reset?token=${token}`;
    await sendMail(email, '【ワンシーンで学ぶ日本語】重置密码', `你好 ${user.nickname}，\n\n点下面的链接设置新密码（30 分钟内有效）：\n${link}\n\n如果不是你本人申请的，忽略这封邮件即可，密码不会改变。`);
  }
  // 不管邮箱存不存在都提示同样的话，避免被用来探测账号。
  return redirect(req, '/login', { m: 'reset_sent' });
}
