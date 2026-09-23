import { cookies } from 'next/headers';
import { getDb, now } from './db';

/**
 * 预览链接：发给朋友试看的只读通行证（Luna 2026-09-23）。
 * 打开 /preview?t=<token> 会把令牌写进 cookie，之后全站按「已解锁」显示；
 * 没有账号，所以 /account、/admin 一律进不去，站上也没有任何能改内容的地方。
 */
export const PREVIEW_COOKIE = 'jp_preview';

export type PreviewLink = { token: string; note: string | null; expires_at: number | null; revoked_at: number | null };

export type PreviewCheck =
  | { ok: true; link: PreviewLink }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' };

export async function checkPreview(token: string | undefined): Promise<PreviewCheck> {
  if (!token) return { ok: false, reason: 'not_found' };
  const db = await getDb();
  const row = await db
    .prepare('SELECT token, note, expires_at, revoked_at FROM preview_links WHERE token = ?')
    .bind(token)
    .first<PreviewLink>();
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  if (row.expires_at && row.expires_at < now()) return { ok: false, reason: 'expired' };
  return { ok: true, link: row };
}

/** 页面渲染时用：cookie 里的预览令牌还有效吗。 */
export async function currentPreview(): Promise<PreviewLink | null> {
  const jar = await cookies();
  const result = await checkPreview(jar.get(PREVIEW_COOKIE)?.value);
  return result.ok ? result.link : null;
}

export function previewCookie(token: string, maxAge: number, req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${PREVIEW_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

export function newPreviewToken(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const arr = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join('');
}
