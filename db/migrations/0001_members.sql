-- 会员系统 v1（2026-09-22）。所有时间戳为 Unix 秒。
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  email_verified_at INTEGER,
  password_hash TEXT NOT NULL,
  nickname TEXT NOT NULL,
  gender TEXT,                -- female / male / other / NULL（选填）
  birth_year INTEGER,         -- 只收出生年（选填）
  study_years TEXT,           -- just_started / under_1y / 1y … 9y / 10y_plus（选填）
  role TEXT NOT NULL DEFAULT 'user',      -- user / admin
  status TEXT NOT NULL DEFAULT 'active',  -- active / banned / deleted
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- 登录会话。id 存的是 cookie 里令牌的 SHA-256，泄露数据库也拿不到可用 cookie。
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- 一次性令牌：邮箱验证 / 重置密码 / 管理员登录验证码。id 同样是令牌的 SHA-256。
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,         -- verify / reset / otp
  code_hash TEXT,             -- otp：6 位验证码的哈希；其余为 NULL
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tokens_user_kind ON tokens(user_id, kind);

-- 邀请码（付费后由管理员手动生成发给用户）。
CREATE TABLE IF NOT EXISTS invite_codes (
  code TEXT PRIMARY KEY,
  note TEXT,                  -- 管理员备注，例如「9月 PayPay 张三」
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,         -- 未用完前的有效期；NULL 永久
  used_by TEXT,
  used_at INTEGER,
  revoked_at INTEGER
);

-- 权益。跟邀请码分开：以后「送 3 个月」「教师账号」等都能表达。
CREATE TABLE IF NOT EXISTS entitlements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,         -- full_course
  source TEXT,                -- invite:<code> / admin:<id>
  granted_at INTEGER NOT NULL,
  expires_at INTEGER          -- NULL 永久
);
CREATE INDEX IF NOT EXISTS idx_entitlements_user ON entitlements(user_id);

-- 限流计数（按 IP / 邮箱）。
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

-- 管理员操作留痕。
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  at INTEGER NOT NULL
);

-- 演示模式的「邮件发件箱」：没有配置邮件服务时，邮件写在这里，/outbox 页面可看。
CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
