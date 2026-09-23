import { checkPreview, previewCookie, PREVIEW_COOKIE } from '@/lib/server/preview';
import { getDb, now } from '@/lib/server/db';
import { redirect } from '@/lib/server/http';
import { clearCookie } from '@/lib/server/auth';

const MAX_AGE = 30 * 24 * 3600;

/** 打开预览链接：/preview?t=<token>。带 ?exit=1 则退出预览。 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('exit')) {
    return redirect(req, '/', { m: 'preview_exit' }, { 'Set-Cookie': clearCookie(PREVIEW_COOKIE) });
  }
  const token = url.searchParams.get('t') ?? '';
  const result = await checkPreview(token);
  if (!result.ok) return redirect(req, '/', { m: `preview_${result.reason}` });
  const db = await getDb();
  await db
    .prepare('UPDATE preview_links SET views = views + 1, last_view_at = ? WHERE token = ?')
    .bind(now(), token)
    .run();
  const maxAge = result.link.expires_at ? Math.max(60, result.link.expires_at - now()) : MAX_AGE;
  return redirect(req, '/', { m: 'preview_ok' }, { 'Set-Cookie': previewCookie(token, maxAge, req) });
}
