import { hashPassword } from '@/lib/server/crypto';
import { consumeToken, destroyAllSessions, validPassword } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/login', { m: 'bad_request' });
  const f = await readForm(req);
  const token = f.token ?? '';
  if (!validPassword(f.password ?? '')) return redirect(req, '/reset', { m: 'bad_password', token });
  if (f.password !== f.password2) return redirect(req, '/reset', { m: 'password_mismatch', token });
  const userId = await consumeToken(token, 'reset');
  if (!userId) return redirect(req, '/forgot', { m: 'reset_bad' });
  const db = await getDb();
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(f.password), userId).run();
  await destroyAllSessions(userId);
  return redirect(req, '/login', { m: 'reset_ok' });
}
