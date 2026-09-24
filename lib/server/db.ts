import { env } from 'cloudflare:workers';
import m0001 from '@/db/migrations/0001_members.sql?raw';
import m0002 from '@/db/migrations/0002_preview.sql?raw';
import m0003 from '@/db/migrations/0003_annual.sql?raw';

/**
 * D1 访问入口。第一次用到时自动把 db/migrations 里的 SQL 按顺序跑一遍
 * （记录在 schema_migrations 表），本地 miniflare 和线上都一样，不需要另外跑命令。
 */
const MIGRATIONS: { name: string; sql: string }[] = [
  { name: '0001_members', sql: m0001 },
  { name: '0002_preview', sql: m0002 },
  { name: '0003_annual', sql: m0003 },
];

let ready: Promise<void> | null = null;

async function migrate(db: D1Database) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(
    ((await db.prepare('SELECT name FROM schema_migrations').all<{ name: string }>()).results ?? []).map((r) => r.name),
  );
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    // D1 的 exec 只接受单行语句拼接；把注释去掉、按分号切开逐条执行。
    const statements = m.sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of statements) await db.prepare(s).run();
    await db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').bind(m.name, now()).run();
  }
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

export async function getDb(): Promise<D1Database> {
  const db = (env as Cloudflare.Env).DB;
  if (!db) throw new Error('D1 绑定 DB 不存在：检查 .openai/hosting.json 的 d1 字段，并重启 dev server');
  if (!ready) ready = migrate(db).catch((e) => {
    ready = null;
    throw e;
  });
  await ready;
  return db;
}

export function envVar<K extends keyof Cloudflare.Env>(key: K): Cloudflare.Env[K] {
  return (env as Cloudflare.Env)[key];
}
