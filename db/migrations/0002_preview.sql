-- 预览链接（Luna 2026-09-23）：发给朋友试看，不用注册账号。只读：拿到链接的人能看全部课程，
-- 但没有账号，改不了任何东西，也进不了 /account 和 /admin。
CREATE TABLE IF NOT EXISTS preview_links (
  token TEXT PRIMARY KEY,
  note TEXT,                  -- 给谁看的备注
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,         -- NULL = 不限
  revoked_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0,
  last_view_at INTEGER
);
