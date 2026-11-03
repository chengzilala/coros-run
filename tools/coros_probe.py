#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高驰 MCP 本地自测工具（纯 Python 标准库，无需 pip 安装任何东西）

它验证的是：**第三方 App 用 OAuth 授权，读取「你自己高驰账号」的训练数据** ——
这正是我们以后 网页 / H5 产品要用的那条路。跑通后，这段授权代码就能长成产品的登录模块。

用法：
    python3 coros_probe.py                 # 授权（首次会弹浏览器登录）+ 列出可用工具
    python3 coros_probe.py login           # 只做授权
    python3 coros_probe.py tools           # 列出工具，并保存到 tools.json
    python3 coros_probe.py call <工具名> '<JSON参数>'
    # 例：python3 coros_probe.py call querySportRecords '{"startDate":"2026-08-01","endDate":"2026-10-08"}'

安全说明：
    - 授权拿到的 token 会存到项目根目录的 .coros_token.json（已在 .gitignore 里，不会被提交）。
    - 本脚本只读你的高驰数据，不会上传到任何地方。
"""

import base64
import hashlib
import json
import os
import secrets
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer

# ---------- 配置 ----------
# 区域：cn（中国区）/ us（北美）/ eu（欧洲）。用环境变量 COROS_REGION 切换。
REGION = os.environ.get("COROS_REGION", "cn")
_REGIONS = {
    "cn": "https://mcpcn.coros.com",
    "us": "https://mcpus.coros.com",
    "eu": "https://mcpeu.coros.com",
}
AUTH_BASE = os.environ.get("COROS_AUTH_BASE", _REGIONS.get(REGION, _REGIONS["cn"]))  # 授权服务器
MCP_URL = os.environ.get("COROS_MCP_URL", AUTH_BASE + "/mcp")  # MCP 数据端点
SCOPE = "openid mcp.tools offline_access"
PORT = 8765
REDIRECT_URI = "http://127.0.0.1:%d/callback" % PORT
PROTOCOL_VERSION = "2025-06-18"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJ_DIR = os.path.dirname(BASE_DIR)
_SUF = "" if REGION == "cn" else "_" + REGION
TOKEN_FILE = os.path.join(PROJ_DIR, ".coros_token%s.json" % _SUF)
CLIENT_FILE = os.path.join(PROJ_DIR, ".coros_client%s.json" % _SUF)
TOOLS_FILE = os.path.join(PROJ_DIR, "tools%s.json" % _SUF)


# ---------- 小工具 ----------
def save_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def load_json(path):
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def http_request(url, data=None, headers=None, method=None):
    """返回 (status, headers_dict, text)"""
    h = {"User-Agent": "coros-local-probe/1.0"}
    if headers:
        h.update(headers)
    body = None
    if data is not None:
        if isinstance(data, (dict, list)):
            body = json.dumps(data).encode("utf-8")
            h.setdefault("Content-Type", "application/json")
        elif isinstance(data, str):
            body = data.encode("utf-8")
            h.setdefault("Content-Type", "application/x-www-form-urlencoded")
        else:
            body = data
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            text = resp.read().decode("utf-8", "replace")
            return resp.status, dict(resp.headers), text
    except urllib.error.HTTPError as e:
        text = e.read().decode("utf-8", "replace")
        return e.code, dict(e.headers), text
    except Exception as e:
        raise SystemExit("网络请求失败（检查是否能访问 coros.com）：%s" % e)


def extract_json(text):
    """兼容普通 JSON 与 SSE(text/event-stream) 两种返回"""
    if not text or not text.strip():
        return None
    try:
        return json.loads(text)
    except Exception:
        pass
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            payload = line[5:].strip()
            try:
                return json.loads(payload)
            except Exception:
                continue
    return None


# ---------- OAuth：动态注册 + PKCE 授权码 ----------
def register_client():
    payload = {
        "client_name": "coros-local-probe",
        "redirect_uris": [REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    }
    status, _, text = http_request(AUTH_BASE + "/connect/register", payload)
    info = extract_json(text)
    if status not in (200, 201) or not info or "client_id" not in info:
        raise SystemExit("注册客户端失败：[%s] %s" % (status, text))
    save_json(CLIENT_FILE, info)
    print("已注册本地客户端，client_id = %s" % info["client_id"])
    return info


def pkce_pair():
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


class _Callback(BaseHTTPRequestHandler):
    def do_GET(self):
        params = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        flat = {k: v[0] for k, v in params.items()}
        if "code" in flat or "error" in flat:
            self.server.result = flat
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(
            "<!doctype html><meta charset=utf-8>"
            "<div style='font-family:-apple-system,sans-serif;padding:40px'>"
            "<h2>高驰授权完成 ✅</h2><p>可以关闭本页面，回到终端窗口继续。</p></div>".encode("utf-8")
        )

    def log_message(self, *args):
        pass


def do_login():
    client = load_json(CLIENT_FILE) or register_client()
    verifier, challenge = pkce_pair()
    state = secrets.token_urlsafe(16)
    server = HTTPServer(("127.0.0.1", PORT), _Callback)
    server.result = None

    params = {
        "response_type": "code",
        "client_id": client["client_id"],
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "login",
        "max_age": "0",
    }
    url = AUTH_BASE + "/oauth2/authorize?" + urllib.parse.urlencode(params)
    print("\n即将打开浏览器进行高驰账号授权……")
    print("如果浏览器没有自动打开，请手动复制这个地址访问：\n%s\n" % url)
    try:
        webbrowser.open(url)
    except Exception:
        pass

    print("等待你在浏览器里完成登录授权（最多 5 分钟）……")
    timer = threading.Timer(300, server.shutdown)
    timer.daemon = True
    timer.start()
    try:
        while server.result is None:
            server.handle_request()
    finally:
        timer.cancel()

    result = server.result or {}
    if "error" in result:
        raise SystemExit("授权被拒绝或出错：%s %s" % (result.get("error"), result.get("error_description", "")))
    if result.get("state") != state:
        raise SystemExit("授权回调 state 不匹配，出于安全已中止。")

    form = {
        "grant_type": "authorization_code",
        "code": result["code"],
        "redirect_uri": REDIRECT_URI,
        "client_id": client["client_id"],
        "code_verifier": verifier,
    }
    status, _, text = http_request(
        AUTH_BASE + "/oauth2/token",
        urllib.parse.urlencode(form),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    token = extract_json(text)
    if not token or "access_token" not in token:
        raise SystemExit("换取 token 失败：[%s] %s" % (status, text))
    save_json(TOKEN_FILE, token)
    print("\n授权成功！token 已保存到 %s" % TOKEN_FILE)
    return token


def load_token():
    return load_json(TOKEN_FILE)


def refresh_token(tok):
    if not tok or not tok.get("refresh_token"):
        return None
    client = load_json(CLIENT_FILE) or {}
    form = {
        "grant_type": "refresh_token",
        "refresh_token": tok["refresh_token"],
        "client_id": client.get("client_id", ""),
    }
    status, _, text = http_request(
        AUTH_BASE + "/oauth2/token",
        urllib.parse.urlencode(form),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    new = extract_json(text)
    if new and "access_token" in new:
        save_json(TOKEN_FILE, new)
        return new
    return None


# ---------- MCP 调用 ----------
def mcp_request(method, params, token, session_id=None, notify=False):
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": PROTOCOL_VERSION,
    }
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    payload = {"jsonrpc": "2.0", "method": method}
    if not notify:
        payload["id"] = 1
    if params is not None:
        payload["params"] = params
    status, resp_headers, text = http_request(MCP_URL, payload, headers)
    new_session = (
        resp_headers.get("Mcp-Session-Id")
        or resp_headers.get("mcp-session-id")
        or session_id
    )
    return status, new_session, extract_json(text), text


def open_session(token):
    status, session, data, text = mcp_request(
        "initialize",
        {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "coros-local-probe", "version": "1.0"},
        },
        token,
    )
    if status >= 400 or (data and data.get("error")):
        raise SystemExit("initialize 失败：[%s]\n%s" % (status, text))
    mcp_request("notifications/initialized", None, token, session_id=session, notify=True)
    return session


def valid_token():
    tok = load_token()
    if not tok:
        return None
    # 简单判断：没有 expires 就直接用；有则提前 60 秒刷新
    return tok


def call_tool(name, arguments, token=None, session=None):
    tok = token or valid_token() or do_login()
    access = tok["access_token"]
    if session is None:
        session = open_session(access)
    status, _, data, text = mcp_request(
        "tools/call", {"name": name, "arguments": arguments}, access, session_id=session
    )
    if status == 401:
        tok = refresh_token(tok) or do_login()
        access = tok["access_token"]
        session = open_session(access)
        status, _, data, text = mcp_request(
            "tools/call", {"name": name, "arguments": arguments}, access, session_id=session
        )
    return status, data, text


def cmd_tools(token):
    session = open_session(token["access_token"])
    status, _, data, text = mcp_request("tools/list", {}, token["access_token"], session_id=session)
    if status >= 400 or not data:
        raise SystemExit("tools/list 失败：[%s]\n%s" % (status, text))
    tools = (data.get("result") or {}).get("tools") or []
    save_json(TOOLS_FILE, tools)
    print("\n可用的高驰工具共 %d 个：" % len(tools))
    for t in tools:
        print("  - %s：%s" % (t.get("name"), (t.get("description") or "").split(".")[0]))
    print("\n完整定义已保存到 %s" % TOOLS_FILE)
    return tools


def main():
    args = sys.argv[1:]
    cmd = args[0] if args else "auto"

    if cmd == "login":
        do_login()
        return

    if cmd == "relogin":
        # 强制重新登录：删掉旧 token，用 prompt=login 逼高驰重新要账号密码
        if os.path.exists(TOKEN_FILE):
            os.remove(TOKEN_FILE)
        token = do_login()
        print("\n--- 用新授权试拉账号信息 ---")
        status, data, text = call_tool("queryUserInfo", {}, token)
        out = ""
        try:
            out = data["result"]["content"][0]["text"][:400]
        except Exception:
            out = text[:400]
        print("HTTP %s | %s" % (status, out))
        return

    token = valid_token()
    if not token:
        token = do_login()

    if cmd == "tools":
        cmd_tools(token)
        return

    if cmd == "call":
        if len(args) < 2:
            raise SystemExit("用法：python3 coros_probe.py call <工具名> '<JSON参数>'")
        name = args[1]
        arguments = json.loads(args[2]) if len(args) > 2 else {}
        status, data, text = call_tool(name, arguments, token)
        print("HTTP %s" % status)
        print(json.dumps(data, ensure_ascii=False, indent=2) if data else text)
        return

    # 默认：列工具 + 试拉最近 30 天运动记录
    cmd_tools(token)
    print("\n--- 试拉最近 30 天运动记录 ---")
    status, data, text = call_tool("querySportRecords", {}, token)
    print("HTTP %s" % status)
    print(json.dumps(data, ensure_ascii=False, indent=2) if data else text)


if __name__ == "__main__":
    main()
