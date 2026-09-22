import { verifyPassword } from '@/lib/server/crypto';
import { currentUserFromRequest, destroyAllSessions, clearCookie, SESSION_COOKIE, audit } from '@/lib/server/auth';
import { getDb, now } from '@/lib/server/db';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

/** 注销账号：软删除——邮箱打乱释放出来、昵称变「已注销用户」，录音等内容以后按状态处理。 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/account', { m: 'bad_request' });
  const user = await currentUserFromRequest(req);
  if (!user) return redirect(req, '/login', { m: 'need_login' });
  const f = await readForm(req);
  const db = await getDb();
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(f.password ?? '', row.password_hash))) return redirect(req, '/account', { m: 'wrong_password' });
  await db
    .prepare(`UPDATE users SET status = 'deleted', email = ?, nickname = '已注销用户', gender = NULL, birth_year = NULL, study_years = NULL WHERE id = ?`)
    .bind(`deleted-${now()}-${user.id}@invalid.local`, user.id)
    .run();
  await destroyAllSessions(user.id);
  await audit(user.id, 'account.delete', user.id);
  return redirect(req, '/', { m: 'deleted' }, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}
