import { cookies } from 'next/headers';
import { envVar, getDb, hasDb, now } from './db';
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
  if (!token || !hasDb()) return null;
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

/** 一年、三个月、永久。邀请码生成时选，兑换时按这个给天数。 */
export const GRANT_OPTIONS: { days: number; label: string }[] = [
  { days: 365, label: '1 年' },
  { days: 90, label: '3 个月' },
  { days: 0, label: '永久' },
];
export const YEAR_DAYS = 365;
export function grantLabel(days: number): string {
  return GRANT_OPTIONS.find((o) => o.days === days)?.label ?? `${days} 天`;
}

/**
 * 会员卡状态（Luna 2026-09-24 拍板的年卡制）。
 * 权益表一行 = 一张卡，续费插新行；当前有效期 = 所有行里最晚的 expires_at（NULL = 永久）。
 * 到期不需要定时任务：每次判断都拿当前时间比一下；到期后自动回到「未解锁」，账号和学习记录都不动。
 */
export type Membership = {
  /** 现在能不能看全部课程 */
  full: boolean;
  /** 到期时间（秒）。null = 永久或从没开过卡 */
  expiresAt: number | null;
  /** 永久卡 */
  forever: boolean;
  /** 开过卡（包括已经到期的） */
  ever: boolean;
  /** 曾经开过、现在已经到期 */
  expired: boolean;
  /** 管理员：永远全开，不显示到期 */
  admin: boolean;
};

export const NO_MEMBERSHIP: Membership = {
  full: false,
  expiresAt: null,
  forever: false,
  ever: false,
  expired: false,
  admin: false,
};

export async function membershipOf(user: User | null): Promise<Membership> {
  if (!user) return NO_MEMBERSHIP;
  if (user.role === 'admin') return { ...NO_MEMBERSHIP, full: true, admin: true };
  const db = await getDb();
  const rows =
    (
      await db
        .prepare(`SELECT expires_at FROM entitlements WHERE user_id = ? AND kind = 'full_course'`)
        .bind(user.id)
        .all<{ expires_at: number | null }>()
    ).results ?? [];
  if (!rows.length) return NO_MEMBERSHIP;
  const forever = rows.some((r) => r.expires_at === null);
  const latest = rows.reduce<number | null>((max, r) => (r.expires_at !== null && (max === null || r.expires_at > max) ? r.expires_at : max), null);
  const full = forever || (latest !== null && latest > now());
  return { full, expiresAt: forever ? null : latest, forever, ever: true, expired: !full, admin: false };
}

export async function hasFullAccess(user: User | null): Promise<boolean> {
  return (await membershipOf(user)).full;
}

/** 到期日（秒）→「2027年9月24日」（日本时区）。 */
export function formatDate(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** 还剩几天到期（向上取整，最少 0）。 */
export function daysLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - now()) / 86400));
}

/**
 * 开卡 / 续费：算新的到期时间。
 * 没到期时从旧到期日往后接（提前续费不吃亏）；已到期或第一次开卡从今天起算。
 */
export function nextExpiry(current: Membership, grantDays: number): number | null {
  if (grantDays <= 0) return null; // 永久
  const base = current.full && current.expiresAt && current.expiresAt > now() ? current.expiresAt : now();
  return base + grantDays * 86400;
}

/** 给用户加一张卡（邀请码兑换、管理员手动送都走这里）。 */
export async function grantCard(userId: string, current: Membership, grantDays: number, source: string): Promise<number | null> {
  const db = await getDb();
  const expires = nextExpiry(current, grantDays);
  await db
    .prepare('INSERT INTO entitlements (id, user_id, kind, source, granted_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(randomId(), userId, 'full_course', source, now(), expires)
    .run();
  return expires;
}

/** ok = 第一次开卡；renewed = 续费；forever = 已经是永久卡，不用再输。 */
export type RedeemResult = 'ok' | 'renewed' | 'forever' | 'not_found' | 'used' | 'expired' | 'revoked';

export async function redeemInvite(user: User, rawCode: string): Promise<RedeemResult> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const db = await getDb();
  const current = await membershipOf(user);
  if (current.forever) return 'forever';
  const row = await db
    .prepare('SELECT * FROM invite_codes WHERE code = ?')
    .bind(code)
    .first<{ code: string; used_by: string | null; expires_at: number | null; revoked_at: number | null; grant_days: number }>();
  if (!row) return 'not_found';
  if (row.revoked_at) return 'revoked';
  if (row.used_by) return 'used';
  if (row.expires_at && row.expires_at < now()) return 'expired';
  // 先占用邀请码再发权益：看影响行数，防止两个请求同时兑换同一张码。
  const claimed = await db
    .prepare('UPDATE invite_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL')
    .bind(user.id, now(), code)
    .run();
  if (!claimed.meta.changes) return 'used';
  await grantCard(user.id, current, row.grant_days ?? YEAR_DAYS, `invite:${code}`);
  return current.full ? 'renewed' : 'ok';
}

export async function audit(actorId: string | null, action: string, target?: string, detail?: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare('INSERT INTO audit_log (id, actor_id, action, target, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(randomId(), actorId, action, target ?? null, detail ?? null, now())
    .run();
}
