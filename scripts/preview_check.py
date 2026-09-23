# /// script
# requires-python = ">=3.12"
# ///
"""预览链接冒烟测试：无效令牌应被挡下，/ 与课程页仍然 200。"""
import urllib.request, urllib.error, http.cookiejar

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), urllib.request.HTTPRedirectHandler())
for path in ["/preview?t=zzzznotreal", "/", "/lesson/biz-01", "/preview?exit=1"]:
    try:
        with op.open(f"http://localhost:3100{path}", timeout=90) as r:
            body = r.read().decode("utf-8", "ignore")
            hit = [k for k in ("预览链接无效", "预览模式", "已退出预览") if k in body]
            print(path, r.status, r.url.split("localhost:3100")[-1], hit)
    except urllib.error.HTTPError as e:
        print(path, e.code, e.read()[:300].decode("utf-8", "ignore"))
    except Exception as e:
        print(path, "ERR", e)
print("cookies:", [c.name for c in jar])
