import { getDb, now } from '@/lib/server/db';
import { consumeToken } from '@/lib/server/auth';
import { redirect } from '@/lib/server/http';

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const userId = await consumeToken(token, 'verify');
  if (!userId) return redirect(req, '/login', { m: 'verify_bad' });
  const db = await getDb();
  await db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').bind(now(), userId).run();
  return redirect(req, '/login', { m: 'verify_ok' });
}
