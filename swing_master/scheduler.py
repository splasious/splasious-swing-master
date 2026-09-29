"""Daily post-close refresh for a long-running ``serve`` process.

At ``SM_REFRESH_AT`` (IST, default 18:40, Monday to Friday) the platform
re-reads its data feed and rebuilds the scan, backtest and paper session
(``Platform.refresh``), then publishes a DAILY_SCAN notification (sent to
Telegram when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are set).  Set
``SM_REFRESH_AT=off`` to disable.  A failed refresh keeps the previous build
and is reported in Data Health; the next day's run tries again.
"""
from __future__ import annotations

import threading
import traceback
from datetime import datetime, time, timedelta, timezone
from typing import Optional

from .logging_utils import log

IST = timezone(timedelta(hours=5, minutes=30))


def parse_at(text: str) -> Optional[time]:
    text = (text or "").strip().lower()
    if text in ("", "off", "none", "0"):
        return None
    hh, _, mm = text.partition(":")
    return time(int(hh), int(mm or 0))


def next_run(now: datetime, at: time) -> datetime:
    """The next weekday at `at` strictly after `now` (both IST-aware)."""
    candidate = now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    if candidate <= now:
        candidate += timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


class DailyRefresh:
    def __init__(self, platform, at: Optional[time]):
        self.platform = platform
        self.at = at
        self.next_at: Optional[datetime] = None
        self.last_at: Optional[datetime] = None
        self.last_result: Optional[dict] = None
        self.last_error: Optional[str] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> "DailyRefresh":
        if self.at is not None and self._thread is None:
            self._thread = threading.Thread(target=self._run, name="daily-refresh", daemon=True)
            self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()

    def _run(self) -> None:
        while not self._stop.is_set():
            self.next_at = next_run(datetime.now(IST), self.at)
            if self._stop.wait((self.next_at - datetime.now(IST)).total_seconds()):
                break
            self.run_once()

    def run_once(self) -> bool:
        self.last_at = datetime.now(IST)
        try:
            self.last_result = self.platform.refresh()
            self.last_error = None
            return True
        except Exception as exc:  # keep serving the previous build
            self.last_error = f"{type(exc).__name__}: {exc}"
            log("error", f"daily refresh failed: {self.last_error}", trace=traceback.format_exc(limit=4))
            self.platform.bus.publish("DATA_DISCONNECTED", {"detail": f"Daily refresh failed: {self.last_error}"})
            return False

    def status(self) -> dict:
        if self.at is None:
            return {"status": "OFF", "detail": "SM_REFRESH_AT=off -- data refreshes only when the server restarts"}
        detail = f"weekdays {self.at:%H:%M} IST"
        if self.next_at:
            detail += f"; next {self.next_at:%a %d %b %H:%M}"
        if self.last_at:
            detail += f"; last {self.last_at:%a %d %b %H:%M}" + (" failed: " + self.last_error if self.last_error else " OK")
        return {"status": "ERROR" if self.last_error else "ON", "detail": detail}
