import { currentUser, type User } from '@/lib/server/auth';

/** 管理页共用：返回管理员用户，或 null（页面自己渲染「请登录 / 没权限」）。 */
export async function requireAdmin(): Promise<User | null> {
  const user = await currentUser();
  return user && user.role === 'admin' ? user : null;
}
