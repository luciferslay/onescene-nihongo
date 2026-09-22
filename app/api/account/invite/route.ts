import { currentUserFromRequest, redeemInvite, audit } from '@/lib/server/auth';
import { allow } from '@/lib/server/ratelimit';
import { readForm, redirect, sameOrigin } from '@/lib/server/http';

export async function POST(req: Request) {
  if (!sameOrigin(req)) return redirect(req, '/account', { m: 'bad_request' });
  const user = await currentUserFromRequest(req);
  if (!user) return redirect(req, '/login', { m: 'need_login', next: '/account' });
  if (!(await allow(`invite:${user.id}`, 10, 3600))) return redirect(req, '/account', { m: 'rate_limited' });
  const f = await readForm(req);
  const r = await redeemInvite(user, f.code ?? '');
  if (r === 'ok') await audit(user.id, 'invite.redeem', user.id, f.code?.trim().toUpperCase());
  return redirect(req, f.next?.startsWith('/') ? f.next : '/account', { m: `invite_${r}` });
}
