"""Self-hosting: the optional access password and the daily post-close refresh."""
import http.client
import os
import threading
import unittest
from datetime import datetime, time
from http.server import ThreadingHTTPServer
from unittest import mock

from swing_master.dashboard import access as access_mod
from swing_master.dashboard.access import COOKIE, MAX_FAILURES, Access
from swing_master.dashboard.server import make_handler, serve
from swing_master.notifications import NotificationBus
from swing_master.scheduler import IST, DailyRefresh, next_run, parse_at


class AccessTokenTests(unittest.TestCase):
    def test_disabled_lets_everything_through(self):
        self.assertTrue(Access("").valid(None))

    def test_token_round_trip_expiry_and_tampering(self):
        a = Access("pw", secret=b"k" * 32)
        tok = a.token(now=1000)
        self.assertTrue(a.valid(f"{COOKIE}={tok}", now=1001))
        self.assertFalse(a.valid(f"{COOKIE}={tok}", now=1000 + 13 * 3600), "expired")
        expiry, sig = tok.split(".")
        self.assertFalse(a.valid(f"{COOKIE}={int(expiry) + 999}.{sig}", now=1001), "expiry edited")
        self.assertFalse(Access("pw", secret=b"x" * 32).valid(f"{COOKIE}={tok}", now=1001), "other key")
        self.assertFalse(a.valid("other=1", now=1001))

    def test_lockout_after_repeated_failures(self):
        a = Access("pw")
        for _ in range(MAX_FAILURES):
            self.assertFalse(a.check("1.2.3.4", "nope", now=100))
        self.assertTrue(a.locked_out("1.2.3.4", now=101))
        self.assertFalse(a.locked_out("5.6.7.8", now=101))
        self.assertFalse(a.locked_out("1.2.3.4", now=100 + access_mod.LOCKOUT_SECONDS + 1))
        self.assertTrue(a.check("1.2.3.4", "pw"))


class ServerAccessTests(unittest.TestCase):
    """The HTTP flow, with a stand-in platform: auth runs before any route."""

    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(object(), Access("s3cret")))
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r, data

    def test_api_needs_a_session(self):
        r, data = self.req("GET", "/api/meta")
        self.assertEqual(r.status, 401)
        self.assertIn(b"Unauthorized", data)
        r, _ = self.req("POST", "/api/settings", body="{}", headers={"Content-Type": "application/json"})
        self.assertEqual(r.status, 401)

    def test_pages_redirect_to_login_and_sign_in_works(self):
        r, _ = self.req("GET", "/")
        self.assertEqual((r.status, r.getheader("Location")), (303, "/login"))
        r, data = self.req("GET", "/login")
        self.assertEqual(r.status, 200)
        self.assertIn(b'type="password"', data)
        form = {"Content-Type": "application/x-www-form-urlencoded"}
        r, data = self.req("POST", "/login", body="password=wrong", headers=form)
        self.assertEqual(r.status, 401)
        self.assertIn(b"Wrong password", data)
        r, _ = self.req("POST", "/login", body="password=s3cret", headers=form)
        self.assertEqual(r.status, 303)
        cookie = r.getheader("Set-Cookie")
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        self.assertNotIn("Secure", cookie, "plain http on localhost")
        r, data = self.req("GET", "/index.html", headers={"Cookie": cookie.split(";")[0]})
        self.assertEqual(r.status, 200)
        self.assertIn(b"<html", data.lower())
        r, _ = self.req("GET", "/logout", headers={"Cookie": cookie.split(";")[0]})
        self.assertIn("Max-Age=0", r.getheader("Set-Cookie"))

    def test_secure_cookie_behind_https_proxy(self):
        r, _ = self.req("POST", "/login", body="password=s3cret",
                        headers={"Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-Proto": "https"})
        self.assertIn("Secure", r.getheader("Set-Cookie"))

    def test_refuses_public_interface_without_password(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("SM_ACCESS_PASSWORD", None)
            os.environ.pop("SM_ALLOW_OPEN", None)
            with self.assertRaises(SystemExit):
                serve(object(), host="0.0.0.0", port=0)


class DailyRefreshTests(unittest.TestCase):
    def test_parse_and_next_run_skip_weekends(self):
        self.assertIsNone(parse_at("off"))
        self.assertEqual(parse_at("18:40"), time(18, 40))
        fri_evening = datetime(2026, 9, 25, 19, 0, tzinfo=IST)  # Friday, after the run time
        self.assertEqual(next_run(fri_evening, time(18, 40)), datetime(2026, 9, 28, 18, 40, tzinfo=IST))
        mon_noon = datetime(2026, 9, 28, 12, 0, tzinfo=IST)
        self.assertEqual(next_run(mon_noon, time(18, 40)), datetime(2026, 9, 28, 18, 40, tzinfo=IST))

    def test_failure_keeps_serving_and_is_reported(self):
        class Broken:
            bus = NotificationBus()

            def refresh(self):
                raise ConnectionError("feed down")

        p = Broken()
        r = DailyRefresh(p, time(18, 40))
        self.assertFalse(r.run_once())
        self.assertEqual(r.status()["status"], "ERROR")
        self.assertIn("feed down", r.status()["detail"])
        self.assertEqual(p.bus.history[-1]["type"], "DATA_DISCONNECTED")
        self.assertEqual(DailyRefresh(p, None).status()["status"], "OFF")


if __name__ == "__main__":
    unittest.main()
