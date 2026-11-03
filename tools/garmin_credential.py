#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""安全录入佳明账号 / 密码 → 优先存 macOS **钥匙串**（不落明文文件）。

为什么这样做：
- 密码用 getpass 录入（输入不显示），不会出现在终端历史、聊天记录或日志里；
- macOS 上写进系统钥匙串（服务名 coros-run-garmin），仓库里、磁盘明文里都没有密码；
- 非 macOS 才退回本机 `.garmin_secret.json`（600 权限，已在 .gitignore）。

用法：
    python3 tools/garmin_credential.py

抓数时 `tools/source_garmin.py` 会自动按「环境变量 → 钥匙串 → 明文文件」的顺序取凭据。
"""
import getpass
import json
import os
import stat
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(HERE)
SECRET_FILE = os.path.join(PROJ, ".garmin_secret.json")
KEYCHAIN_SERVICE = "coros-run-garmin"


def read_keychain():
    """已存在则返回 (email, password)，否则 (None, None)。"""
    if sys.platform != "darwin":
        return None, None
    pwd = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
                         capture_output=True, text=True)
    if pwd.returncode != 0:
        return None, None
    info = subprocess.run(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE],
                          capture_output=True, text=True)
    email = ""
    for line in (info.stdout or "").splitlines():
        if '"acct"<blob>=' in line:
            email = line.split('"acct"<blob>=', 1)[1].strip().strip('"')
            break
    return email, (pwd.stdout or "").strip()


def main():
    kc_email, _ = read_keychain()
    old_email = kc_email or ""
    if not old_email and os.path.exists(SECRET_FILE):
        try:
            old_email = (json.load(open(SECRET_FILE, encoding="utf-8")) or {}).get("email") or ""
        except Exception:
            old_email = ""
    old_email = old_email or os.environ.get("GARMIN_EMAIL") or ""

    prompt = "佳明账号邮箱 [%s]: " % old_email if old_email else "佳明账号邮箱: "
    email = input(prompt).strip() or old_email
    if not email:
        raise SystemExit("邮箱不能为空。")

    password = getpass.getpass("佳明密码（输入不显示）: ")
    if not password:
        raise SystemExit("密码不能为空。")

    if sys.platform == "darwin":
        r = subprocess.run(["security", "add-generic-password", "-U", "-s", KEYCHAIN_SERVICE,
                            "-a", email, "-w", password], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit("写入钥匙串失败：%s" % (r.stderr or "").strip()[:200])
        print("已保存到 macOS 钥匙串（服务 %s，账户 %s）" % (KEYCHAIN_SERVICE, email))
        if os.path.exists(SECRET_FILE):
            os.remove(SECRET_FILE)
            print("已删除旧的明文文件 %s" % SECRET_FILE)
        return

    with open(SECRET_FILE, "w", encoding="utf-8") as f:
        json.dump({"email": email, "password": password}, f, ensure_ascii=False)
        f.write("\n")
    os.chmod(SECRET_FILE, stat.S_IRUSR | stat.S_IWUSR)
    print("已保存到 %s（本机私有，已 gitignore；非 macOS 无法用钥匙串）" % SECRET_FILE)


if __name__ == "__main__":
    main()
