import { currentUserFromRequest, audit } from '@/lib/server/auth';
import { getDb, now } from '@/lib/server/db';
import { newPreviewToken } from '@/lib/server/preview';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

/** 生成 / 作废预览链接（只有管理员能用）。 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/admin/invites', { m: 'bad_request' });
  const admin = await currentUserFromRequest(req);
  if (!admin) return redirect(req, '/login', { m: 'need_login', next: '/admin/invites' });
  if (admin.role !== 'admin') return redirect(req, '/', { m: 'forbidden' });
  const f = await readForm(req);
  const db = await getDb();

  if (f.action === 'revoke' && f.token) {
    await db.prepare('UPDATE preview_links SET revoked_at = ? WHERE token = ?').bind(now(), f.token).run();
    await audit(admin.id, 'preview.revoke', f.token);
    return redirect(req, '/admin/invites', { m: 'saved' });
  }

  const days = Number(f.days) || 0;
  const token = newPreviewToken();
  await db
    .prepare('INSERT INTO preview_links (token, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(token, (f.note ?? '').trim() || null, admin.id, now(), days > 0 ? now() + days * 86400 : null)
    .run();
  await audit(admin.id, 'preview.create', token, f.note);
  return redirect(req, '/admin/invites', { m: 'saved', preview: token });
}
