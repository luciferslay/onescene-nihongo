import { cookies } from 'next/headers';
import { envVar, getDb, now } from './db';
import { randomCode, randomId, randomToken, sha256 } from './crypto';

export const SESSION_COOKIE = 'hc_session';
export const OTP_COOKIE = 'hc_otp';
const SESSION_SHORT = 7 * 24 * 3600;   // 不勾「记住我」：7 天
const SESSION_LONG = 30 * 24 * 3600;   // 勾了：30 天
const VERIFY_TTL = 24 * 3600;
const RESET_TTL = 30 * 60;
const OTP_TTL = 10 * 60;

export type User = {
  id: string;
  email: string;
  email_verified_at: number | null;
  nickname: string;
  gender: string | null;
  birth_year: number | null;
  study_years: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'banned' | 'deleted';
  created_at: number;
  last_login_at: number | null;
};

export const STUDY_YEARS: { key: string; label: string }[] = [
  { key: 'just_started', label: '刚开始' },
  { key: 'under_1y', label: '1 年未满' },
  { key: '1y', label: '1 年' },
  { key: '2y', label: '2 年' },
  { key: '3y', label: '3 年' },
  { key: '4y', label: '4 年' },
  { key: '5y', label: '5 年' },
  { key: '6y', label: '6 年' },
  { key: '7y', label: '7 年' },
  { key: '8y', label: '8 年' },
  { key: '9y', label: '9 年' },
  { key: '10y_plus', label: '10 年以上' },
];
export const GENDERS: { key: string; label: string }[] = [
  { key: 'female', label: '女' },
  { key: 'male', label: '男' },
  { key: 'other', label: '都不是' },
];

export function isAdminEmail(email: string): boolean {
  const list = (envVar('ADMIN_EMAILS') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

/** 昵称：2–12 个字符，允许中英韩日文字、数字、空格、下划线。 */
export function validNickname(n: string): boolean {
  const s = n.trim();
  const len = Array.from(s).length;
  return len >= 2 && len <= 12 && /^[\p{L}\p{N} _]+$/u.test(s);
}
export function validEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
}
export function validPassword(p: string): boolean {
  return p.length >= 8 && p.length <= 128;
}

// ---------- 会话 ----------

export async function createSession(userId: string, remember: boolean, req?: Request): Promise<{ token: string; maxAge: number }> {
  const db = await getDb();
  const token = randomToken();
  const maxAge = remember ? SESSION_LONG : SESSION_SHORT;
  await db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at, remember, ip_hash, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(
      await sha256(token),
      userId,
      now() + maxAge,
      now(),
      remember ? 1 : 0,
      req ? await sha256((req.headers.get('cf-connecting-ip') ?? '') + (envVar('AUTH_SECRET') ?? '')) : null,
      req?.headers.get('user-agent')?.slice(0, 200) ?? null,
    )
    .run();
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now(), userId).run();
  return { token, maxAge };
}

export function sessionCookie(token: string, maxAge: number, req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}
export function clearCookie(name: string): string {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

export async function destroySession(token: string): Promise<void> {
  const db = await getDb();
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
}
export async function destroyAllSessions(userId: string): Promise<void> {
  const db = await getDb();
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export async function userFromSessionToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const db = await getDb();
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND u.status = 'active'`,
    )
    .bind(await sha256(token), now())
    .first<User>();
  return row ?? null;
}

/** 服务端组件 / 路由里取当前登录用户。 */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
}

export async function currentUserFromRequest(req: Request): Promise<User | null> {
  const m = req.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return userFromSessionToken(m?.[1]);
}

// ---------- 用户 ----------

export async function findUserByEmail(email: string): Promise<(User & { password_hash: string }) | null> {
  const db = await getDb();
  return (await db.prepare('SELECT * FROM users WHERE email = ?').bind(email.toLowerCase()).first<User & { password_hash: string }>()) ?? null;
}
export async function findUserById(id: string): Promise<User | null> {
  const db = await getDb();
  return (await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<User>()) ?? null;
}

// ---------- 一次性令牌 ----------

export async function issueToken(userId: string, kind: 'verify' | 'reset'): Promise<string> {
  const db = await getDb();
  const token = randomToken();
  await db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').bind(userId, kind).run();
  await db
    .prepare('INSERT INTO tokens (id, user_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, kind, now() + (kind === 'verify' ? VERIFY_TTL : RESET_TTL), now())
    .run();
  return token;
}

/** 校验并消费令牌；成功返回 user_id。 */
export async function consumeToken(token: string, kind: 'verify' | 'reset'): Promise<string | null> {
  const db = await getDb();
  const id = await sha256(token);
  const row = await db
    .prepare('SELECT user_id FROM tokens WHERE id = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .bind(id, kind, now())
    .first<{ user_id: string }>();
  if (!row) return null;
  await db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').bind(now(), id).run();
  return row.user_id;
}

/** 管理员登录第二步：发 6 位验证码，返回放进 cookie 的挑战令牌。 */
export async function issueOtp(userId: string): Promise<{ challenge: string; code: string }> {
  const db = await getDb();
  const challenge = randomToken();
  const code = randomCode();
  await db.prepare('DELETE FROM tokens WHERE user_id = ? AND kind = ?').bind(userId, 'otp').run();
  await db
    .prepare('INSERT INTO tokens (id, user_id, kind, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(await sha256(challenge), userId, 'otp', await sha256(code + userId), now() + OTP_TTL, now())
    .run();
  return { challenge, code };
}

export async function verifyOtp(challenge: string, code: string): Promise<string | null> {
  const db = await getDb();
  const id = await sha256(challenge);
  const row = await db
    .prepare('SELECT user_id, code_hash, attempts FROM tokens WHERE id = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .bind(id, 'otp', now())
    .first<{ user_id: string; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= 5) return null;
  if (row.code_hash !== (await sha256(code + row.user_id))) {
    await db.prepare('UPDATE tokens SET attempts = attempts + 1 WHERE id = ?').bind(id).run();
    return null;
  }
  await db.prepare('UPDATE tokens SET used_at = ? WHERE id = ?').bind(now(), id).run();
  return row.user_id;
}

// ---------- 权益与邀请码 ----------

export async function hasFullAccess(user: User | null): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const db = await getDb();
  const row = await db
    .prepare(`SELECT 1 AS ok FROM entitlements WHERE user_id = ? AND kind = 'full_course' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`)
    .bind(user.id, now())
    .first<{ ok: number }>();
  return !!row;
}

export type RedeemResult = 'ok' | 'not_found' | 'used' | 'expired' | 'revoked' | 'already';

export async function redeemInvite(user: User, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const db = await getDb();
  if (await hasFullAccess(user)) return 'already';
  const row = await db
    .prepare('SELECT * FROM invite_codes WHERE code = ?')
    .bind(code)
    .first<{ code: string; used_by: string | null; expires_at: number | null; revoked_at: number | null }>();
  if (!row) return 'not_found';
  if (row.revoked_at) return 'revoked';
  if (row.used_by) return 'used';
  if (row.expires_at && row.expires_at < now()) return 'expired';
  await db.batch([
    db.prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL').bind(user.id, now(), code),
    db
      .prepare('INSERT INTO entitlements (id, user_id, kind, source, granted_at) VALUES (?, ?, ?, ?, ?)')
      .bind(randomId(), user.id, 'full_course', `invite:${code}`, now()),
  ]);
  return 'ok';
}

export async function audit(actorId: string | null, action: string, target?: string, detail?: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare('INSERT INTO audit_log (id, actor_id, action, target, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(randomId(), actorId, action, target ?? null, detail ?? null, now())
    .run();
}
