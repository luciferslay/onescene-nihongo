import { currentUserFromRequest, audit } from '@/lib/server/auth';
import { getDb, now } from '@/lib/server/db';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

function newCode(): string {
  // 形如 JP-7K3M-QX9A：去掉易混淆的 0/O/1/I
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const arr = crypto.getRandomValues(new Uint8Array(8));
  const s = Array.from(arr, (b) => alphabet[b % alphabet.length]).join('');
  return `JP-${s.slice(0, 4)}-${s.slice(4)}`;
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/admin/invites', { m: 'bad_request' });
  const admin = await currentUserFromRequest(req);
  if (!admin) return redirect(req, '/login', { m: 'need_login', next: '/admin/invites' });
  if (admin.role !== 'admin') return redirect(req, '/', { m: 'forbidden' });
  const f = await readForm(req);
  const db = await getDb();

  if (f.action === 'revoke' && f.code) {
    await db.prepare('UPDATE invite_codes SET revoked_at = ? WHERE code = ? AND used_by IS NULL').bind(now(), f.code).run();
    await audit(admin.id, 'invite.revoke', f.code);
    return redirect(req, '/admin/invites', { m: 'saved' });
  }

  const count = Math.min(Math.max(Number(f.count) || 1, 1), 50);
  const days = Number(f.days) || 0;
  const expires = days > 0 ? now() + days * 86400 : null;
  const codes: string[] = [];
  const stmts = [];
  for (let i = 0; i < count; i++) {
    const code = newCode();
    codes.push(code);
    stmts.push(
      db
        .prepare('INSERT INTO invite_codes (code, note, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(code, (f.note ?? '').trim() || null, admin.id, now(), expires),
    );
  }
  await db.batch(stmts);
  await audit(admin.id, 'invite.create', codes.join(','), f.note);
  return redirect(req, '/admin/invites', { m: 'saved', created: codes.join(',') });
}
