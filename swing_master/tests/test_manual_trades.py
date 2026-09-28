"""Section 38: manual management of open paper trades -- tighten-only stops, manual close, survives a rebuild."""
import json
import tempfile
import unittest
from pathlib import Path

from swing_master.app import Platform
from swing_master.config import AppSettings, StrategyConfig
from swing_master.data.demo import DemoMarketData
from swing_master.schemas import ExitReason

SYMBOLS = ["NIFTY", "APOLLOHOSP", "TCS", "GRASIM", "RELIANCE", "INFY"]  # three trades are open at the demo end


class ManualTradeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        settings = AppSettings()
        settings.STATE_DIR = Path(cls.tmp.name)
        cfg = StrategyConfig().with_overrides(MIN_ZONE_SCORE=60, MIN_CONFLUENCE_SCORE=65)
        cls.p = Platform(settings, cfg=cfg, provider=DemoMarketData(), persist=False, symbols=SYMBOLS)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def _open(self):
        self.assertTrue(self.p.paper.open_trades, "fixture must leave a paper trade open")
        return self.p.paper.open_trades[0]

    def test_stop_only_tightens_and_close_persists(self):
        t = self._open()
        tid, sign = t.trade_id, (1 if t.direction == "LONG" else -1)
        last = self.p.datasets[t.symbol].bars[-1].close
        with self.assertRaises(ValueError):
            self.p.manual_stop(tid, t.current_stop - sign * 1.0)  # loosening
        with self.assertRaises(ValueError):
            self.p.manual_stop(tid, last + sign * 1.0)  # through the price
        new_stop = t.current_stop + (last - t.current_stop) * 0.5
        out = self.p.manual_stop(tid, new_stop)
        self.assertAlmostEqual(out["current_stop"], round(new_stop, 2), places=1)
        self.assertEqual(t.trail_history[-1]["reason"], "Manual stop tighten")

        n_orders = len(self.p.paper_broker.orders())
        closed = self.p.manual_close(tid)
        self.assertEqual(closed["exit_reason"], ExitReason.MANUAL_CLOSE)
        self.assertNotIn(tid, [x.trade_id for x in self.p.paper.open_trades])
        self.assertEqual(len(self.p.paper_broker.orders()), n_orders + 1, "the exit order is recorded")
        saved = json.loads((Path(self.tmp.name) / "manual_actions.json").read_text())
        self.assertEqual([a["action"] for a in saved], ["STOP", "CLOSE"])

        self.p.build()  # a rebuild re-simulates the session; the saved actions are applied again
        self.assertNotIn(tid, [x.trade_id for x in self.p.paper.open_trades])
        self.assertIn(ExitReason.MANUAL_CLOSE, [x.exit_reason for x in self.p.paper.trades if x.trade_id == tid])

    def test_not_allowed_outside_paper_modes(self):
        self.p.execution_mode = "BACKTEST"
        try:
            with self.assertRaises(PermissionError):
                self.p.manual_close("anything")
        finally:
            self.p.execution_mode = "PAPER"
        with self.assertRaises(KeyError):
            self.p.manual_close("no-such-trade")


if __name__ == "__main__":
    unittest.main()
