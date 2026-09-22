/** 路由处理器共用的小工具：表单读取、同源校验、带提示的跳转。 */

export async function readForm(req: Request): Promise<Record<string, string>> {
  const fd = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}

/** 表单 POST 必须来自本站（防 CSRF；配合 SameSite=Lax cookie）。 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin') ?? req.headers.get('referer');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export function redirect(req: Request, path: string, params?: Record<string, string>, headers?: HeadersInit): Response {
  const url = new URL(path, req.url);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const h = new Headers(headers);
  h.set('Location', url.pathname + url.search);
  return new Response(null, { status: 303, headers: h });
}

export function appOrigin(req: Request, override?: string): string {
  return override?.replace(/\/$/, '') || new URL(req.url).origin;
}

/** 站内提示文案。页面用 ?m=<key> 显示。 */
export const MESSAGES: Record<string, { kind: 'ok' | 'error'; text: string }> = {
  bad_email: { kind: 'error', text: '邮箱格式不对。' },
  bad_password: { kind: 'error', text: '密码至少 8 位。' },
  password_mismatch: { kind: 'error', text: '两次输入的密码不一致。' },
  bad_nickname: { kind: 'error', text: '昵称要 2–12 个字，只能用中英韩文、数字、空格和下划线。' },
  email_taken: { kind: 'error', text: '这个邮箱已经注册过了，直接登录或找回密码。' },
  need_terms: { kind: 'error', text: '需要先同意利用规约与隐私政策。' },
  rate_limited: { kind: 'error', text: '操作太频繁，请稍后再试。' },
  login_failed: { kind: 'error', text: '邮箱或密码不对。' },
  not_verified: { kind: 'error', text: '邮箱还没验证，请先点邮件里的链接。' },
  banned: { kind: 'error', text: '这个账号已被停用。' },
  verify_ok: { kind: 'ok', text: '邮箱验证成功，现在可以登录了。' },
  verify_bad: { kind: 'error', text: '验证链接无效或已过期，请重新发送。' },
  verify_resent: { kind: 'ok', text: '验证邮件已重新发送。' },
  reset_sent: { kind: 'ok', text: '如果这个邮箱注册过，重置链接已经发出（30 分钟内有效）。' },
  reset_bad: { kind: 'error', text: '重置链接无效或已过期，请重新申请。' },
  reset_ok: { kind: 'ok', text: '密码已重置，请用新密码登录。' },
  otp_bad: { kind: 'error', text: '验证码不对或已过期。' },
  otp_sent: { kind: 'ok', text: '验证码已发到你的邮箱（10 分钟内有效）。' },
  saved: { kind: 'ok', text: '已保存。' },
  wrong_password: { kind: 'error', text: '当前密码不对。' },
  password_changed: { kind: 'ok', text: '密码已修改，其他设备已退出登录。' },
  invite_ok: { kind: 'ok', text: '解锁成功，全部课程都可以看了。' },
  invite_not_found: { kind: 'error', text: '没有这个邀请码，检查一下有没有输错。' },
  invite_used: { kind: 'error', text: '这个邀请码已经被使用过了。' },
  invite_expired: { kind: 'error', text: '这个邀请码已过期。' },
  invite_revoked: { kind: 'error', text: '这个邀请码已作废。' },
  invite_already: { kind: 'ok', text: '你已经解锁全部课程了。' },
  need_login: { kind: 'error', text: '请先登录。' },
  forbidden: { kind: 'error', text: '没有权限。' },
  signup_ok: { kind: 'ok', text: '注册成功！验证邮件已发出，点邮件里的链接完成验证。' },
  deleted: { kind: 'ok', text: '账号已注销。' },
  bad_request: { kind: 'error', text: '请求无效，请重试。' },
};
