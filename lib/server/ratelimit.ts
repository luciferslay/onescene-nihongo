import { getDb, now } from './db';

/**
 * 固定窗口限流：同一个 key 在 windowSec 内最多 limit 次。返回 true 表示放行。
 * 用 D1 而不是内存，是因为 Workers 的实例随时会换，内存计数不可靠。
 */
export async function allow(key: string, limit: number, windowSec: number): Promise<boolean> {
  const db = await getDb();
  const t = now();
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first<{ count: number; reset_at: number }>();
  if (!row || row.reset_at <= t) {
    await db
      .prepare('INSERT OR REPLACE INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)')
      .bind(key, t + windowSec)
      .run();
    return true;
  }
  if (row.count >= limit) return false;
  await db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

export function clientIp(req: Request): string {
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0';
}
