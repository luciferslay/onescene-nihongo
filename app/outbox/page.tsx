import AuthShell from '@/components/auth/shell';
import { getDb } from '@/lib/server/db';
import { isDemoMail } from '@/lib/server/mail';

/** 演示模式专用：显示「本应发出去的邮件」。接了真实邮件服务后这一页自动关闭。 */
export default async function OutboxPage() {
  if (!isDemoMail()) return <AuthShell title="这一页只在演示模式开放"><p className="text-sm">邮件服务已配置，邮件会真的发到用户邮箱。</p></AuthShell>;
  const db = await getDb();
  const rows = (await db.prepare('SELECT * FROM outbox ORDER BY created_at DESC LIMIT 50').all<{ id: string; to_email: string; subject: string; body: string; created_at: number }>()).results ?? [];
  const linkify = (text: string) =>
    text.split(/(https?:\/\/\S+)/g).map((part, i) =>
      /^https?:\/\//.test(part) ? (
        <a key={i} href={part.replace(/^https?:\/\/[^/]+/, '')} className="break-all font-bold text-coral underline">{part}</a>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  return (
    <AuthShell title="演示发件箱" eyebrow="演示模式" wide>
      <p className="text-sm text-ink/70">最近 50 封。链接可以直接点。</p>
      <ul className="mt-4 space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-2xl border border-ink/10 bg-white/70 p-4 text-sm">
            <p className="text-xs text-ink/50">
              收件人 {r.to_email} · {new Date(r.created_at * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' })}
            </p>
            <p className="mt-1 font-bold">{r.subject}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{linkify(r.body)}</pre>
          </li>
        ))}
        {!rows.length && <li className="text-sm text-ink/60">还没有邮件。</li>}
      </ul>
    </AuthShell>
  );
}
