# /// script
# requires-python = ">=3.12"
# ///
"""本地预览路由检查：逐个请求页面，打印 HTTP 状态码和出错时的前几百字。"""
import urllib.error
import urllib.request

for path in ["/", "/lesson/biz-01", "/review", "/audio/standard/biz-01/dialogue-01.m4a", "/lobby-meishi.png"]:
    url = f"http://localhost:3100{path}"
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            body = r.read()
            print(path, r.status, len(body), "找不到这节课" in body.decode("utf-8", "ignore"))
    except urllib.error.HTTPError as e:
        print(path, e.code, e.read()[:600].decode("utf-8", "ignore"))
    except Exception as e:
        print(path, "ERR", e)
