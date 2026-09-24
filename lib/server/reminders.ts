import { SITE_NAME } from '@/lib/site';
import { formatDate, daysLeft } from './auth';
import { getDb, now } from './db';
import { sendMail } from './mail';

/**
 * 年卡到期提醒（Luna 2026-09-24）：到期前 7 天一封、到期当天一封。
 * 没有定时任务 —— 任意带登录态的请求顺手触发一次扫描，用 meta 表记上次扫描时间，每小时最多一次。
 * 扫描失败不影响页面（调用方 catch 掉）。
 */
const SCAN_KEY = 'expiry_scan_at';
const SCAN_INTERVAL = 3600;

type Row = {
  id: string;
  user_id: string;
  expires_at: number;
  reminder_7d_at: number | null;
  reminder_0d_at: number | null;
  email: string;
  nickname: string;
};

/** 每小时最多扫一次：抢到「上次扫描时间」这一行才继续。 */
async function claimScan(): Promise<boolean> {
  const db = await getDb();
  const row = await db.prepare('SELECT value FROM meta WHERE key = ?').bind(SCAN_KEY).first<{ value: string }>();
  const last = row ? Number(row.value) : 0;
  if (last && now() - last < SCAN_INTERVAL) return false;
  const r = row
    ? await db.prepare('UPDATE meta SET value = ? WHERE key = ? AND value = ?').bind(String(now()), SCAN_KEY, row.value).run()
    : await db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)').bind(SCAN_KEY, String(now())).run();
  return !!r.meta.changes;
}

export async function scanExpiryReminders(): Promise<void> {
  if (!(await claimScan())) return;
  const db = await getDb();
  // 只看每个用户最晚到期的那张卡；有永久卡、被停用、管理员都不发。
  const rows =
    (
      await db
        .prepare(
          `SELECT e.id, e.user_id, e.expires_at, e.reminder_7d_at, e.reminder_0d_at, u.email, u.nickname
             FROM entitlements e JOIN users u ON u.id = e.user_id
            WHERE e.kind = 'full_course' AND e.expires_at IS NOT NULL
              AND u.status = 'active' AND u.role = 'user'
              AND e.expires_at <= ?
              -- 每个用户只取一行：最晚到期的那张卡。两张卡到期日相同时也只取一行，
              -- 否则会给同一个人发两封同样的提醒（2026-09-24 验收时踩到）。
              AND e.id = (SELECT x.id FROM entitlements x
                           WHERE x.user_id = e.user_id AND x.kind = 'full_course' AND x.expires_at IS NOT NULL
                           ORDER BY x.expires_at DESC, x.id LIMIT 1)
              AND NOT EXISTS (SELECT 1 FROM entitlements y WHERE y.user_id = e.user_id AND y.kind = 'full_course' AND y.expires_at IS NULL)
            LIMIT 200`,
        )
        .bind(now() + 7 * 86400)
        .all<Row>()
    ).results ?? [];

  for (const r of rows) {
    const expired = r.expires_at <= now();
    if (expired && !r.reminder_0d_at) {
      await sendMail(
        r.email,
        `【${SITE_NAME}】年卡已到期`,
        `${r.nickname} 你好，\n\n你的年卡已于 ${formatDate(r.expires_at)} 到期，现在每一课只能看第 1 步（场景任务和对话）。\n学习记录都还在，输入新的邀请码就能接着学。\n\n${SITE_NAME}`,
      );
      await db.prepare('UPDATE entitlements SET reminder_0d_at = ? WHERE id = ?').bind(now(), r.id).run();
    } else if (!expired && !r.reminder_7d_at) {
      await sendMail(
        r.email,
        `【${SITE_NAME}】年卡还有 ${daysLeft(r.expires_at)} 天到期`,
        `${r.nickname} 你好，\n\n你的年卡将于 ${formatDate(r.expires_at)} 到期（还有 ${daysLeft(r.expires_at)} 天）。\n在到期前输入新的邀请码，新的一年会从原到期日往后接着算。\n\n${SITE_NAME}`,
      );
      await db.prepare('UPDATE entitlements SET reminder_7d_at = ? WHERE id = ?').bind(now(), r.id).run();
    }
  }
}

/** 页面里调用：失败不抛。 */
export async function maybeScanExpiryReminders(): Promise<void> {
  try {
    await scanExpiryReminders();
  } catch {
    // 提醒邮件不该影响页面
  }
}
