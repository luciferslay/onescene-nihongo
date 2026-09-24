-- 会员改成「年卡制」（Luna 2026-09-24，韩语站同日改的同一套规格）。
-- 邀请码兑换 = 开一张卡；续费再输一个码，没到期就从旧到期日往后接。
ALTER TABLE invite_codes ADD COLUMN grant_days INTEGER NOT NULL DEFAULT 365;
ALTER TABLE entitlements ADD COLUMN reminder_7d_at INTEGER;
ALTER TABLE entitlements ADD COLUMN reminder_0d_at INTEGER;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
UPDATE entitlements SET expires_at = granted_at + 31536000 WHERE kind = 'full_course' AND expires_at IS NULL AND source LIKE 'invite:%';
