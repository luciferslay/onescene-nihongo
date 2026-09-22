import { createSession, sessionCookie, verifyOtp, clearCookie, OTP_COOKIE } from '@/lib/server/auth';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/login', { m: 'bad_request' });
  const f = await readForm(req);
  const next = f.next?.startsWith('/') && !f.next.startsWith('//') ? f.next : '/admin';
  const m = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${OTP_COOKIE}=([^;]+)`));
  const raw = m?.[1] ?? '';
  const remember = raw.endsWith('.r');
  const challenge = remember ? raw.slice(0, -2) : raw;
  const userId = challenge ? await verifyOtp(challenge, (f.code ?? '').trim()) : null;
  if (!userId) return redirect(req, '/login/otp', { m: 'otp_bad', next });
  const s = await createSession(userId, remember, req);
  const headers = new Headers();
  headers.append('Set-Cookie', sessionCookie(s.token, s.maxAge, req));
  headers.append('Set-Cookie', clearCookie(OTP_COOKIE));
  return redirect(req, next, undefined, headers);
}
