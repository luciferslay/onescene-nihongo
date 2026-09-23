import { currentUser, hasFullAccess, type User } from './auth';
import { currentPreview } from './preview';

/**
 * 课程门禁规则（Luna 2026-09-22）：每一课的第 1 步（场景任务 + 听对话）人人可用；
 * 第 2 步起需要登录并用邀请码解锁。日语站沿用（Luna 2026-09-23）。
 */
/** preview：没有账号、靠预览链接进来的访客（只读）。 */
export type Access = { user: User | null; full: boolean; preview: boolean };

export async function currentAccess(): Promise<Access> {
  const user = await currentUser();
  if (user) return { user, full: await hasFullAccess(user), preview: false };
  // 没登录时才看预览链接：自己的账号状态优先。
  const preview = await currentPreview();
  return { user: null, full: !!preview, preview: !!preview };
}
