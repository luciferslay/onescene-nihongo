import { clearCookie, destroySession, SESSION_COOKIE } from '@/lib/server/auth';
import { redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/', { m: 'bad_request' });
  const m = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (m?.[1]) await destroySession(m[1]);
  return redirect(req, '/', undefined, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}
