import { hashPassword, verifyPassword } from '@/lib/server/crypto';
import { currentUserFromRequest, destroyAllSessions, createSession, sessionCookie, validPassword } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/account', { m: 'bad_request' });
  const user = await currentUserFromRequest(req);
  if (!user) return redirect(req, '/login', { m: 'need_login', next: '/account' });
  const f = await readForm(req);
  const db = await getDb();
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(f.current ?? '', row.password_hash))) return redirect(req, '/account', { m: 'wrong_password' });
  if (!validPassword(f.password ?? '')) return redirect(req, '/account', { m: 'bad_password' });
  if (f.password !== f.password2) return redirect(req, '/account', { m: 'password_mismatch' });
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(f.password), user.id).run();
  await destroyAllSessions(user.id);
  const s = await createSession(user.id, false, req);
  return redirect(req, '/account', { m: 'password_changed' }, { 'Set-Cookie': sessionCookie(s.token, s.maxAge, req) });
}
