import { currentUser, membershipOf, type Membership, type User } from './auth';
import { currentPreview } from './preview';
import { maybeScanExpiryReminders } from './reminders';
import { hasDb } from './db';

/**
 * 课程门禁规则：每一课的第 1 步（场景任务 + 听对话）人人可用；第 2 步起要解锁。
 * 解锁方式有两种：会员的年卡（Luna 2026-09-24 改成年卡制），或朋友试看用的预览链接（只读）。
 */
export type Access = { user: User | null; full: boolean; preview: boolean; card: Membership; enabled: boolean };

/** 会员功能是否开通（= 有没有绑定数据库）。线上没配数据库时全站照旧全部开放，不显示登录入口。 */
export function membersEnabled(): boolean {
  return hasDb();
}

export async function currentAccess(): Promise<Access> {
  if (!membersEnabled()) {
    return {
      user: null,
      full: true,
      preview: false,
      card: { full: true, expiresAt: null, forever: false, ever: false, expired: false, admin: false },
      enabled: false,
    };
  }
  const user = await currentUser();
  if (user) {
    // 带登录态的请求顺手扫一次到期提醒（每小时最多一次，失败不影响页面）。
    await maybeScanExpiryReminders();
    const card = await membershipOf(user);
    return { user, full: card.full, preview: false, card, enabled: true };
  }
  // 没登录时才看预览链接：自己的账号状态优先。
  const preview = await currentPreview();
  return {
    user: null,
    full: !!preview,
    preview: !!preview,
    card: { full: !!preview, expiresAt: null, forever: false, ever: false, expired: false, admin: false },
    enabled: true,
  };
}
