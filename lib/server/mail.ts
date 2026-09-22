import { envVar, getDb, now } from './db';
import { randomId } from './crypto';

/**
 * 发邮件。配置了 RESEND_API_KEY 就真发；没有就是演示模式——
 * 邮件写进 outbox 表，在 /outbox 页面能看到（演示模式下才开放该页面）。
 */
export function isDemoMail(): boolean {
  return !envVar('RESEND_API_KEY');
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  const key = envVar('RESEND_API_KEY');
  if (!key) {
    const db = await getDb();
    await db
      .prepare('INSERT INTO outbox (id, to_email, subject, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(randomId(), to, subject, text, now())
      .run();
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: envVar('MAIL_FROM') ?? 'ワンシーンで学ぶ日本語 <onboarding@resend.dev>', to, subject, text }),
  });
  if (!res.ok) throw new Error(`邮件发送失败：${res.status} ${await res.text()}`);
}
