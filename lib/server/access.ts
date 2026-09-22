import { currentUser, hasFullAccess, type User } from './auth';

/**
 * 课程门禁规则（Luna 2026-09-22）：每一课的第 1 步（场景任务 + 听对话）人人可用；
 * 第 2 步起需要登录并用邀请码解锁。日语站沿用（Luna 2026-09-23）。
 */
export type Access = { user: User | null; full: boolean };

export async function currentAccess(): Promise<Access> {
  const user = await currentUser();
  return { user, full: await hasFullAccess(user) };
}
