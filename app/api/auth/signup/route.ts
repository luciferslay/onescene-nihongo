import { getDb, now, envVar } from '@/lib/server/db';
import { hashPassword, randomId } from '@/lib/server/crypto';
import { findUserByEmail, isAdminEmail, issueToken, validEmail, validNickname, validPassword, GENDERS, STUDY_YEARS, redeemInvite, findUserById } from '@/lib/server/auth';
import { allow, clientIp } from '@/lib/server/ratelimit';
import { sendMail } from '@/lib/server/mail';
import { appOrigin, readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/signup', { m: 'bad_request' });
  const f = await readForm(req);
  const email = (f.email ?? '').trim().toLowerCase();
  const back = (m: string) => redirect(req, '/signup', { m, email, nickname: f.nickname ?? '' });

  if (!(await allow(`signup:${clientIp(req)}`, 5, 3600))) return back('rate_limited');
  if (!validEmail(email)) return back('bad_email');
  if (!validPassword(f.password ?? '')) return back('bad_password');
  if (f.password !== f.password2) return back('password_mismatch');
  if (!validNickname(f.nickname ?? '')) return back('bad_nickname');
  if (f.terms !== 'on') return back('need_terms');
  if (await findUserByEmail(email)) return back('email_taken');

  const gender = GENDERS.some((g) => g.key === f.gender) ? f.gender : null;
  const birthYear = /^\d{4}$/.test(f.birth_year ?? '') ? Number(f.birth_year) : null;
  const studyYears = STUDY_YEARS.some((s) => s.key === f.study_years) ? f.study_years : null;

  const db = await getDb();
  const id = randomId();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, nickname, gender, birth_year, study_years, role, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    )
    .bind(id, email, await hashPassword(f.password), f.nickname.trim(), gender, birthYear, studyYears, isAdminEmail(email) ? 'admin' : 'user', now())
    .run();

  // 注册时填了邀请码就顺手兑换（失败不影响注册，账户页可以再输）。
  let inviteNote = '';
  if (f.invite?.trim()) {
    const u = await findUserById(id);
    const r = u ? await redeemInvite(u, f.invite) : 'not_found';
    inviteNote = r === 'ok' ? 'ok' : r;
  }

  const token = await issueToken(id, 'verify');
  const link = `${appOrigin(req, envVar('APP_ORIGIN'))}/api/auth/verify?token=${token}`;
  await sendMail(email, '【ワンシーンで学ぶ日本語】请验证你的邮箱', `你好 ${f.nickname.trim()}，\n\n点下面的链接完成邮箱验证（24 小时内有效）：\n${link}\n\n如果这不是你本人的操作，忽略这封邮件即可。`);

  return redirect(req, '/login', { m: 'signup_ok', email, ...(inviteNote ? { invite: inviteNote } : {}) });
}
