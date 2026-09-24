import { YEAR_DAYS, currentUserFromRequest, audit, destroyAllSessions, grantCard, membershipOf, findUserById } from '@/lib/server/auth';
import { getDb, now } from '@/lib/server/db';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/admin/users', { m: 'bad_request' });
  const admin = await currentUserFromRequest(req);
  if (!admin) return redirect(req, '/login', { m: 'need_login', next: '/admin/users' });
  if (admin.role !== 'admin') return redirect(req, '/', { m: 'forbidden' });
  const f = await readForm(req);
  const db = await getDb();
  const back = () => redirect(req, '/admin/users', { m: 'saved', q: f.q ?? '' });
  const target = f.user_id ?? '';
  if (!target || target === admin.id) return back();

  switch (f.action) {
    case 'ban':
      await db.prepare(`UPDATE users SET status = 'banned' WHERE id = ? AND role != 'admin'`).bind(target).run();
      await destroyAllSessions(target);
      await audit(admin.id, 'user.ban', target);
      break;
    case 'unban':
      await db.prepare(`UPDATE users SET status = 'active' WHERE id = ? AND status = 'banned'`).bind(target).run();
      await audit(admin.id, 'user.unban', target);
      break;
    case 'grant': {
      // 手动开 1 年 / 送 1 年：和邀请码一样的接续规则（没到期就从旧到期日往后接）。
      const u = await findUserById(target);
      if (u) await grantCard(target, await membershipOf(u), YEAR_DAYS, `admin:${admin.id}`);
      await audit(admin.id, 'entitlement.grant', target, '1年');
      break;
    }
    case 'revoke_access':
      await db.prepare(`DELETE FROM entitlements WHERE user_id = ? AND kind = 'full_course'`).bind(target).run();
      await audit(admin.id, 'entitlement.revoke', target);
      break;
    case 'verify':
      await db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').bind(now(), target).run();
      await audit(admin.id, 'user.verify', target);
      break;
  }
  return back();
}
