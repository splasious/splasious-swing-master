"""Optional password for the self-hosted dashboard.

Set ``SM_ACCESS_PASSWORD`` and every page and ``/api`` call needs a signed,
HttpOnly session cookie obtained from ``/login``.  Unset, the server behaves
as before -- which is only allowed on a loopback address (``serve`` refuses
to listen on a public interface without a password unless
``SM_ALLOW_OPEN=1``).

The password is read from the environment when the server starts and is
never stored in settings, logs or API responses.  Sessions are signed with
``SM_SESSION_SECRET`` if set, else a random key per process (a restart logs
everyone out).  Repeated wrong passwords from one address are locked out
for a few minutes.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import os
import secrets
import threading
import time
from http.cookies import CookieError, SimpleCookie
from typing import Dict, Optional, Tuple

PASSWORD_ENV = "SM_ACCESS_PASSWORD"
SECRET_ENV = "SM_SESSION_SECRET"
COOKIE = "sm_session"
TTL_SECONDS = 12 * 3600
MAX_FAILURES = 8
LOCKOUT_SECONDS = 300
LOOPBACK = ("127.0.0.1", "localhost", "::1")


class Access:
    def __init__(self, password: Optional[str] = None, secret: Optional[bytes] = None):
        self.password = password or ""
        self.secret = secret or secrets.token_bytes(32)
        self._failures: Dict[str, Tuple[int, float]] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "Access":
        secret = os.environ.get(SECRET_ENV)
        return cls(os.environ.get(PASSWORD_ENV), hashlib.sha256(secret.encode()).digest() if secret else None)

    @property
    def enabled(self) -> bool:
        return bool(self.password)

    def _sign(self, expiry: int) -> str:
        return hmac.new(self.secret, str(expiry).encode(), hashlib.sha256).hexdigest()

    def token(self, now: Optional[float] = None) -> str:
        expiry = int((now if now is not None else time.time()) + TTL_SECONDS)
        return f"{expiry}.{self._sign(expiry)}"

    def valid(self, cookie_header: Optional[str], now: Optional[float] = None) -> bool:
        if not self.enabled:
            return True
        jar = SimpleCookie()
        try:
            jar.load(cookie_header or "")
        except CookieError:
            return False
        morsel = jar.get(COOKIE)
        if morsel is None:
            return False
        expiry, _, sig = morsel.value.partition(".")
        if not expiry.isdigit() or int(expiry) < (now if now is not None else time.time()):
            return False
        return hmac.compare_digest(sig, self._sign(int(expiry)))

    def locked_out(self, client: str, now: Optional[float] = None) -> bool:
        now = now if now is not None else time.time()
        with self._lock:
            count, last = self._failures.get(client, (0, 0.0))
            if count >= MAX_FAILURES and now - last < LOCKOUT_SECONDS:
                return True
            if count >= MAX_FAILURES:
                self._failures.pop(client, None)
            return False

    def check(self, client: str, attempt: str, now: Optional[float] = None) -> bool:
        """Constant-time password check that records failures per client address."""
        ok = hmac.compare_digest(hashlib.sha256(attempt.encode()).digest(), hashlib.sha256(self.password.encode()).digest())
        with self._lock:
            if ok:
                self._failures.pop(client, None)
            else:
                count, _ = self._failures.get(client, (0, 0.0))
                self._failures[client] = (count + 1, now if now is not None else time.time())
        return ok

    def cookie(self, secure: bool, clear: bool = False) -> str:
        value, age = ("", 0) if clear else (self.token(), TTL_SECONDS)
        return f"{COOKIE}={value}; Path=/; Max-Age={age}; HttpOnly; SameSite=Strict" + ("; Secure" if secure else "")


def login_page(error: str = "") -> bytes:
    msg = f'<p class="err" role="alert">{html.escape(error)}</p>' if error else ""
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Swing Master · Sign in</title>
<style>
:root {{ --bg:#f3f6fa; --panel:#fff; --text:#0f1b2d; --muted:#5b6b80; --border:#d5dde8; --accent:#1f6feb; --down:#c62828; color-scheme: light; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#0b1220; --panel:#121b2d; --text:#e6edf6; --muted:#93a1b5; --border:#24324a; --accent:#4c8dff; --down:#ff6b6b; color-scheme: dark; }} }}
body {{ margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--text);
  font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; padding:0 16px; }}
form {{ width:100%; max-width:360px; background:var(--panel); border:1px solid var(--border); border-radius:12px; padding:28px 24px; display:grid; gap:14px; }}
h1 {{ margin:0; font-size:20px; letter-spacing:.04em; }} p {{ margin:0; color:var(--muted); font-size:13.5px; }}
label {{ font-size:13px; font-weight:600; }}
input {{ width:100%; box-sizing:border-box; min-height:44px; padding:8px 12px; border:1px solid var(--border); border-radius:8px; background:var(--bg); color:var(--text); font:inherit; }}
input:focus-visible, button:focus-visible {{ outline:2px solid var(--accent); outline-offset:2px; }}
button {{ min-height:44px; border:0; border-radius:8px; background:var(--accent); color:#fff; font:inherit; font-weight:700; cursor:pointer; }}
.err {{ color:var(--down); font-weight:600; }}
</style></head><body>
<form method="post" action="/login"><h1>SWING MASTER</h1><p>This dashboard is private. Enter the access password.</p>{msg}
<div style="display:grid;gap:6px"><label for="pw">Access password</label><input id="pw" name="password" type="password" autocomplete="current-password" required autofocus></div>
<button type="submit">Sign in</button></form></body></html>""".encode()
