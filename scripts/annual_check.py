# /// script
# requires-python = ">=3.12"
# ///
"""年卡制验收（本地 dev server，Luna 2026-09-24 的规格）。

走真实 HTTP：注册 → 验邮箱 → 登录 → 管理员生成邀请码 → 兑换 → 续费 → 到期。
「把到期日改到 5 天后 / 改到过去」这两步没有页面入口，直接改本地 miniflare 的 sqlite（只有本地 dev 有）。
"""
import re, sqlite3, time, urllib.parse, urllib.request, http.cookiejar
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://localhost:3100"
DB = next(p for p in (ROOT / ".wrangler/state/v3/d1/miniflare-D1DatabaseObject").glob("*.sqlite") if len(p.stem) == 64)
ADMIN = "lunafan716@gmail.com"
MEMBER = f"member{int(time.time())}@example.com"
PW = "test12345"
ok = fail = 0


def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  [OK] {name}")
    else:
        fail += 1
        print(f"  [NG] {name} {extra}")


def client():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def get(op, path):
    with op.open(BASE + path, timeout=120) as r:
        # React 会在文字中间插 <!-- --> 分隔符，比对前去掉
        return r.url, re.sub(r"<!--.*?-->", "", r.read().decode("utf-8", "ignore"))


def post(op, path, data):
    req = urllib.request.Request(
        BASE + path,
        data=urllib.parse.urlencode(data).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Origin": BASE},
    )
    with op.open(req, timeout=120) as r:
        return r.url, r.read().decode("utf-8", "ignore")


def db():
    return sqlite3.connect(DB)


def outbox(to, subject_like):
    """取最近一封发给 to、标题含 subject_like 的邮件。"""
    with db() as c:
        row = c.execute(
            "SELECT subject, body FROM outbox WHERE to_email = ? AND subject LIKE ? ORDER BY created_at DESC LIMIT 1",
            (to, f"%{subject_like}%"),
        ).fetchone()
    return row


def signup(op, email, nickname):
    post(op, "/api/auth/signup", {"email": email, "password": PW, "password2": PW, "nickname": nickname, "terms": "on"})
    row = outbox(email, "验证你的邮箱")
    link = re.search(r"http://[^\s]+/api/auth/verify\?token=[\w.-]+", row[1]).group(0)
    get(op, link.replace(BASE, ""))


def login(op, email, admin=False):
    url, _ = post(op, "/api/auth/login", {"email": email, "password": PW, "remember": "on"})
    if admin:
        code = re.search(r"验证码是：(\d{6})", outbox(email, "验证码")[1]).group(1)
        post(op, "/api/auth/otp", {"code": code, "next": "/admin"})


print("== 准备：管理员与会员账号 ==")
admin_op, member_op = client(), client()
with db() as c:
    c.execute("DELETE FROM entitlements WHERE user_id IN (SELECT id FROM users WHERE email = ? OR email LIKE 'member%@example.com')", (ADMIN,))
    c.execute("DELETE FROM users WHERE email = ? OR email LIKE 'member%@example.com'", (ADMIN,))
    c.execute("DELETE FROM outbox")
    c.execute("DELETE FROM rate_limits")
signup(admin_op, ADMIN, "站长")
login(admin_op, ADMIN, admin=True)
url, body = get(admin_op, "/admin/invites")
check("管理员能进 /admin/invites", "邀请码" in body and "预览链接" in body)

def make_invite(grant_days, note="验收"):
    url, _ = post(admin_op, "/api/admin/invites", {"note": note, "count": "1", "days": "30", "grant_days": str(grant_days)})
    return re.search(r"created=([A-Z0-9%-]+)", url).group(1).replace("%2C", ",")

signup(member_op, MEMBER, "测试会员")
login(member_op, MEMBER)

print("== 1. 新用户输一年码 → 账号页显示 1 年后的到期日 ==")
code = make_invite(365)
url, body = post(member_op, "/api/account/invite", {"code": code, "next": "/account"})
want = time.strftime("%Y年", time.localtime(time.time() + 365 * 86400))
check("提示解锁成功", "invite_ok" in url, url)
url, body = get(member_op, "/account")
check("账号页显示年卡有效期", "年卡有效期至" in body and want in body)

with db() as c:
    uid = c.execute("SELECT id FROM users WHERE email = ?", (MEMBER,)).fetchone()[0]

print("== 2. 到期日改到 5 天后 → 黄色提示 + 7 天提醒邮件 + 续费接续 ==")
five = int(time.time()) + 5 * 86400
with db() as c:
    c.execute("UPDATE entitlements SET expires_at = ?, reminder_7d_at = NULL WHERE user_id = ?", (five, uid))
    c.execute("DELETE FROM meta WHERE key = 'expiry_scan_at'")
url, body = get(member_op, "/account")
check("显示还有 5 天到期", "还有 5 天到期" in body, body[body.find("年卡有效期") : body.find("年卡有效期") + 200] if "年卡有效期" in body else "")
check("续费框在", "续费：输入新的邀请码" in body)
mail = outbox(MEMBER, "还有")
check("收到到期前提醒邮件", bool(mail), mail)
code2 = make_invite(365)
url, _ = post(member_op, "/api/account/invite", {"code": code2, "next": "/account"})
check("提示续费成功", "invite_renewed" in url, url)
with db() as c:
    newest = c.execute("SELECT MAX(expires_at) FROM entitlements WHERE user_id = ?", (uid,)).fetchone()[0]
check("新到期日 = 原到期日 + 1 年", abs(newest - (five + 365 * 86400)) < 90, f"{newest} vs {five + 365 * 86400}")

print("== 3. 到期日改到过去 → 锁回第 1 步、到期邮件只发一次 ==")
past = int(time.time()) - 86400
with db() as c:
    c.execute("UPDATE entitlements SET expires_at = ?, reminder_0d_at = NULL WHERE user_id = ?", (past, uid))
    c.execute("DELETE FROM meta WHERE key = 'expiry_scan_at'")
url, body = get(member_op, "/lesson/biz-01")
check("课程页锁回第 1 步", "你的年卡已到期" in body and "续费" in body)
url, body = get(member_op, "/account")
check("账号页显示已到期", "到期" in body and "学习记录都还在" in body)
with db() as c:
    n1 = c.execute("SELECT COUNT(*) FROM outbox WHERE to_email = ? AND subject LIKE '%已到期%'", (MEMBER,)).fetchone()[0]
    c.execute("DELETE FROM meta WHERE key = 'expiry_scan_at'")
get(member_op, "/account")
with db() as c:
    n2 = c.execute("SELECT COUNT(*) FROM outbox WHERE to_email = ? AND subject LIKE '%已到期%'", (MEMBER,)).fetchone()[0]
check("到期邮件发了一封", n1 == 1, n1)
check("再扫一次不会重复发", n2 == 1, n2)

print("== 4. 永久码 → 再输提示永久解锁；管理员不受影响 ==")
code3 = make_invite(0, "永久")
url, _ = post(member_op, "/api/account/invite", {"code": code3, "next": "/account"})
check("永久码兑换成功", "invite_ok" in url or "invite_renewed" in url, url)
url, body = get(member_op, "/account")
check("账号页显示永久解锁", "永久解锁" in body)
code4 = make_invite(365)
url, _ = post(member_op, "/api/account/invite", {"code": code4, "next": "/account"})
check("永久账号再输码 → 提示永久", "invite_forever" in url, url)
url, body = get(admin_op, "/account")
check("管理员账号页不显示到期", "管理员" in body and "年卡有效期至" not in body)
url, body = get(admin_op, "/admin/users")
check("用户列表有「年卡到期」栏", "年卡到期" in body)
check("用户列表有「送 1 年」或「手动开 1 年」", "送 1 年" in body or "手动开 1 年" in body)

print(f"\n结果：通过 {ok}，失败 {fail}")
