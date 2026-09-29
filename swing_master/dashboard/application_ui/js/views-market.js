/* Swing Master -- Overview and Scanner. */
(function () {
  "use strict";
  const SM = window.SM, ui = SM.ui, esc = SM.esc;

  // ------------------------------------------------------------------ Overview
  SM.views.overview = {
    title: "Overview", icon: "grid", group: "Market",
    async render(el) {
      const ov = await SM.api.get("/api/overview");
      SM.state.overview = ov;
      const a = ov.account;
      el.innerHTML = `
        <div class="view-head"><div><h1>Trading command centre</h1>
          <p>Structure first, then zones, value, positioning, derivatives and confirmation. Every number below is computed chronologically from the ${SM.state.meta.demo ? "demo" : "loaded"} dataset.</p></div></div>
        ${onboarding()}
        <div class="kpi-row">
          ${ui.kpi({ label: "Account (Paper)", value: SM.inr(a.equity), sub: `Capital ${SM.inr(a.capital)}`, icon: "bank", cls: "compact" })}
          ${ui.kpi({ label: "Open Risk" + ui.tip("Money lost if every open position hit its current stop. Zero once stops sit at or beyond entry."), value: `${SM.inr(a.open_risk)} <small class="muted">(${SM.fmt(a.open_risk_pct, 2)}%)</small>`, sub: `Cap ${SM.fmt(a.max_risk_pct, 1)}% of equity`, icon: "shield", cls: "compact" })}
          ${ui.kpi({ label: "Session P&L", value: ui.money(a.total_pnl), sub: `Realized ${SM.signedInr(a.realized_pnl)} · Open ${SM.signedInr(a.open_pnl)}`, icon: "bars", cls: "compact" })}
          ${ui.kpi({ label: "Open Positions", value: String(a.open_positions), sub: `Risk/trade ${SM.fmt(a.risk_per_trade_pct, 1)}%`, icon: "briefcase", cls: "compact" })}
          ${ui.kpi({ label: "Win Rate (session)", value: a.closed_trades ? SM.pct(a.win_rate, 1) : "—", sub: `${a.closed_trades || 0} closed trades`, icon: "target", cls: "compact" })}
          ${ui.kpi({ label: "Avg R (session)" + ui.tip("Average net result per closed trade, in multiples of the initial risk (R)."), value: `<span class="${SM.dir(a.avg_r)}">${SM.isNum(a.avg_r) ? SM.signed(a.avg_r, 2) + "R" : "—"}</span>`, sub: "Net of costs", icon: "trend", cls: "compact" })}
        </div>
        <div class="grid g-main">
          <div id="ov-chart"></div>
          <div id="ov-plan" class="grid"></div>
        </div>
        <div class="grid g-2">
          <div id="ov-long"></div>
          <div id="ov-short"></div>
        </div>
        <div class="grid g-2">
          <div id="ov-pos"></div>
          <div id="ov-signals"></div>
        </div>
        <div id="ov-trades"></div>
        <div id="ov-watch"></div>`;
      SM.parts.chartCard(el.querySelector("#ov-chart"), { height: 430, compact: true });
      SM.parts.planCards(el.querySelector("#ov-plan"), SM.state.symbol, true);
      renderSetups(el.querySelector("#ov-long"), ov.top_long, "LONG", ov);
      renderSetups(el.querySelector("#ov-short"), ov.top_short, "SHORT", ov);
      renderPositioning(el.querySelector("#ov-pos"), ov);
      renderSignals(el.querySelector("#ov-signals"), ov);
      renderTrades(el.querySelector("#ov-trades"), ov.active_trades);
      renderWatchlist(el.querySelector("#ov-watch"));
      const gs = el.querySelector("#gs-close");
      if (gs) gs.addEventListener("click", () => { SM.store.set("sm.onboarding.dismissed", true); el.querySelector(".getting-started").remove(); });
    },
  };

  function onboarding() {
    if (SM.store.get("sm.onboarding.dismissed", false)) return "";
    const m = SM.state.meta;
    const steps = [
      { done: !m.demo, title: "Connect market data", text: m.demo ? "Running on demo data. Add TradingMaster credentials to use real F&O data." : `Using ${m.source}.`, href: "#health" },
      { done: false, title: "Review risk limits", text: `Risk ${SM.fmt(100 * (m.risk_per_trade || 0.01), 1)}% per trade, max ${m.max_positions || 5} positions.`, href: "#settings" },
      { done: ["PAPER", "SEMI_AUTO"].includes(m.execution_mode), title: "Practise on paper", text: `Mode: ${SM.title(m.execution_mode)}. Confirm proposals in Active Trades.`, href: "#trades" },
      { done: m.broker && m.broker.status === "LIVE", title: "Connect a broker", text: "Locked until backtest, walk-forward and paper results are validated.", href: "#settings" },
    ];
    return `<section class="getting-started card" aria-label="Get started">
      <div class="gs-head"><div><b>Get started</b><span class="muted">From research to controlled execution</span></div>
        <button class="iconbtn" type="button" id="gs-close" aria-label="Hide get started">${SM.icon("x")}</button></div>
      <ol class="gs-steps">${steps.map((st, i) => `<li class="${st.done ? "done" : ""}"><a href="${st.href}"><span class="gs-n">${st.done ? "✓" : i + 1}</span>
        <span><b>${esc(st.title)}</b><small>${esc(st.text)}</small></span></a></li>`).join("")}</ol></section>`;
  }

  async function renderWatchlist(el) {
    const draw = async () => {
      if (!document.body.contains(el)) return;
      const wl = SM.watchlist.all();
      let rows = [];
      if (wl.length) {
        try { rows = (await SM.api.get("/api/scanner")).rows.filter((r) => wl.includes(r.symbol)); } catch (e) { rows = []; }
      }
      el.innerHTML = ui.card({ title: `Watchlist <span class="badge b-accent">${wl.length}</span>`, sub: "saved in this browser", body: '<div id="ov-wl"></div>', flush: true });
      ui.table(el.querySelector("#ov-wl"), { compact: true, rows, rowKey: (r) => r.symbol + r.direction, onRow: (r) => SM.openSymbol(r.symbol, "setup"),
        empty: ui.empty("Your watchlist is empty", "Tap ☆ next to a symbol in the Scanner to follow it here."), columns: [
          { key: "symbol", label: "Symbol", render: (r) => `${SM.watchlist.star(r.symbol)}<span class="sym">${esc(r.symbol)}</span>` },
          { key: "price", label: "Price", num: true, render: (r) => SM.fmt(r.price) }, { key: "change_pct", label: "Chg", num: true, render: (r) => ui.chg(r.change_pct) },
          { key: "structure", label: "Structure", render: (r) => ui.trendBadge(r.structure) }, { key: "setup_type", label: "Setup", sm: false },
          { key: "direction", label: "Dir", render: (r) => ui.dirBadge(r.direction) },
          { key: "confluence", label: "Confluence", num: true, render: (r) => ui.scoreChip(r.confluence, SM.state.meta.min_conf) },
          { key: "status", label: "Status", render: (r) => ui.status(r.status) },
        ] });
    };
    document.addEventListener("sm:watchlist", draw);
    draw();
  }

  function renderSetups(el, rows, dir, ov) {
    const id = "ov-t-" + dir;
    el.innerHTML = ui.card({ title: dir === "LONG" ? "Top long setups" : "Top short setups", sub: dir === "LONG" ? "demand zones in uptrends" : "supply zones in downtrends",
      actions: `<a href="#scanner" class="btn">Scanner ${SM.icon("arrow")}</a>`,
      body: `${dir === "LONG" ? `<div class="toolbar" style="margin-bottom:8px">${Object.entries(ov.scanner_counts).map(([k, v]) => `${ui.status(k)} <span class="num muted">${v}</span>`).join(" ")}</div>` : ""}<div id="${id}"></div>`,
      note: "Click a row for the full decision breakdown." });
    ui.table(el.querySelector("#" + id), {
      compact: true, rows, rowKey: (r) => r.symbol + r.direction, onRow: (r) => SM.openSymbol(r.symbol, "setup"),
      columns: [
        { key: "symbol", label: "Symbol", render: (r) => `<span class="sym">${esc(r.symbol)}</span>` },
        { key: "direction", label: "Dir", render: (r) => ui.dirBadge(r.direction) },
        { key: "zone_type", label: "Zone", render: (r) => r.zone_type ? `<span class="${r.zone_type === "DEMAND" ? "up" : "down"}">${SM.title(r.zone_type)}</span>` : "—" },
        { key: "zone_score", label: "Score", num: true, render: (r) => ui.scoreChip(r.confluence != null ? r.confluence : r.zone_score, r.confluence != null ? SM.state.meta.min_conf : null) },
        { key: "status", label: "Status", render: (r) => ui.status(r.status) },
      ],
      empty: ui.empty(`No ${dir.toLowerCase()} setups`, dir === "LONG" ? "No demand zone in an uptrend is close to price." : "No supply zone in a downtrend is close to price."),
    });
  }

  function renderPositioning(el, ov) {
    const cats = ov.positioning;
    const prox = ov.positioning_proxy;
    const rows = ["COMMERCIAL", "INSTITUTIONAL", "RETAIL"].map((k) => {
      const c = cats[k];
      return `<tr><td>${SM.title(k)}</td><td>${ui.status(c.status)}</td><td class="num">${c.classification ? esc(c.classification) : "—"}</td></tr>`;
    }).join("");
    el.innerHTML = ui.card({ title: "Positioning", sub: "Latest",
      body: `<div class="table-wrap"><table class="table compact"><thead><tr><th>Participant</th><th>Source</th><th class="num">Class</th></tr></thead><tbody>${rows}
        <tr><td>Futures OI (Proxy)</td><td>${ui.status(prox ? "PROXY" : "UNAVAILABLE")}</td><td class="num">${prox ? esc(prox.state) : "—"}</td></tr>
        <tr><td>OI change</td><td></td><td class="num">${prox ? ui.chg(prox.oi_change_pct) : "—"}</td></tr></tbody></table></div>`,
      note: "Participant positioning is never inferred from price or volume. It stays UNAVAILABLE until a genuine source is loaded." });
  }

  function renderSignals(el, ov) {
    const items = ov.recent_signals.slice(0, 9);
    el.innerHTML = ui.card({ title: "Recent signals", sub: "Paper session",
      body: items.length ? `<div class="table-wrap"><table class="table compact"><tbody>${items.map((s) => `<tr class="clickable" data-sym="${esc(s.symbol)}" tabindex="0">
        <td>${SM.dateShort(s.time)}</td><td class="sym">${esc(s.symbol)}</td><td>${ui.dirBadge(s.direction)}</td>
        <td class="num">${ui.scoreChip(s.score, SM.state.meta.min_conf)}</td><td>${ui.status(s.status)}</td></tr>`).join("")}</tbody></table></div>`
        : ui.empty("No signals in this session"),
      note: `<a href="#rejected">Why were signals rejected? →</a>` });
    el.querySelectorAll("tr[data-sym]").forEach((tr) => {
      const go = () => SM.openSymbol(tr.dataset.sym, "setup");
      tr.addEventListener("click", go);
      tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
    });
  }

  function renderTrades(el, trades) {
    el.innerHTML = ui.card({ title: `Active trades <span class="badge b-solid-accent">${trades.length}</span>`, actions: `<a class="btn" href="#trades">Manage ${SM.icon("arrow")}</a>`, body: '<div id="ov-trades-t"></div>' });
    SM.parts.tradesTable(el.querySelector("#ov-trades-t"), trades, true);
  }

  // ------------------------------------------------------------------ Scanner
  SM.views.scanner = {
    title: "Scanner", icon: "search", group: "Market",
    async render(el) {
      const tf = ["1W", "1D", "4H", "1H"].includes(SM.state.scanTf) ? SM.state.scanTf : "1D";
      let d;
      try { d = await SM.api.get("/api/scanner", tf === "1D" ? {} : { tf }); }
      catch (err) {
        el.innerHTML = `<div class="view-head"><div><h1>Setup scanner</h1></div><div class="actions">${ui.seg("sctf", SM.state.meta.scanner_timeframes, tf, true)}</div></div>${ui.card({ title: `${tf} scan`, body: ui.error(err) })}`;
        ui.bindSeg(el, "sctf", (v) => { SM.state.scanTf = v; SM.render(); });
        return;
      }
      const f = d.funnel;
      const steps = [["universe", SM.state.meta.universe_info && SM.state.meta.universe_info.mode === "ALL" ? "NSE universe" : "F&amp;O universe"], ["htf_structure", "HTF structure"], ["valid_zones", "Valid zones"], ["volume_poc", "Volume / POC"],
        ["positioning", "Positioning"], ["candle", "Candle confirm"], ["rr", "R:R"], ["final", "Final candidates"]];
      const filt = { status: "ALL", dir: "ALL", q: "", sector: "ALL", setup: "ALL", watch: false };
      const sectors = [...new Set(d.rows.map((r) => r.sector).filter(Boolean))].sort();
      const setups = [...new Set(d.rows.map((r) => r.setup_type).filter(Boolean))];
      el.innerHTML = `
        <div class="view-head"><div><h1>Setup scanner</h1><p>${esc(d.timeframe)} scan of ${esc(SM.state.meta.universe_name)}, as of ${SM.dateTime(d.as_of)}. Statuses come from the same decision engine the backtester uses.${["4H", "1H"].includes(d.timeframe) ? " Intraday scans are computed on demand." : ""}</p></div>
          <div class="actions"><span class="muted" style="font-size:12px">Timeframe</span>${ui.seg("sctf", SM.state.meta.scanner_timeframes, tf, true)}</div></div>
        ${ui.card({ title: "Funnel", sub: "Each stage keeps the symbols that pass it", body: `<div class="funnel">${steps.map(([k, lab], i) => `
          <div class="step ${i === steps.length - 1 ? "final" : ""}"><span>${lab}</span><b>${f[k]}</b>${ui.bar(f.universe ? f[k] / f.universe : 0, i === steps.length - 1 ? "" : "up")}</div>`).join("")}</div>`,
          note: "Positioning is passed through (not scored) while no participant source is loaded." })}
        ${ui.card({ title: "Setups", actions: `
          <div class="toolbar">
            ${ui.seg("dir", [["ALL", "All"], ["LONG", "Long"], ["SHORT", "Short"]], "ALL", true)}
            ${["ALL", "READY", "ACTIVE", "WAIT", "WATCH", "REJECTED"].map((s) => `<button type="button" class="chip" data-st="${s}" aria-pressed="${s === "ALL"}">${s === "ALL" ? "All" : SM.title(s)} <span class="n">${s === "ALL" ? d.rows.length : d.counts[s] || 0}</span></button>`).join("")}
            <select class="select" id="sc-sector" aria-label="Sector"><option value="ALL">All sectors</option>${sectors.map((x) => `<option>${esc(x)}</option>`).join("")}</select>
            <select class="select" id="sc-setup" aria-label="Setup type"><option value="ALL">All setups</option>${setups.map((x) => `<option>${esc(x)}</option>`).join("")}</select>
            <button type="button" class="chip" id="sc-watch" aria-pressed="false" title="Show only symbols on your watchlist">★ Watchlist</button>
            <input class="input" id="sc-q" type="search" placeholder="Filter symbol or sector" aria-label="Filter symbol or sector">
          </div>`, body: '<div id="sc-table"></div>', flush: true,
          note: "READY = every rule passed on the latest bar · WAIT = in a qualified zone, confirmation pending · WATCH = approaching a qualified zone · REJECTED = a hard rule failed (hover the reason)." })}`;
      const tableEl = el.querySelector("#sc-table");
      const t = ui.table(tableEl, { rows: d.rows, rowKey: (r) => r.symbol + r.direction, onRow: (r) => SM.openSymbol(r.symbol, "setup"), columns: scannerColumns(), caption: "Scanner results" });
      const apply = () => {
        const q = filt.q.toLowerCase();
        const wl = SM.watchlist.all();
        t.setRows(d.rows.filter((r) => (filt.status === "ALL" || r.status === filt.status) && (filt.dir === "ALL" || r.direction === filt.dir)
          && (filt.sector === "ALL" || r.sector === filt.sector) && (filt.setup === "ALL" || r.setup_type === filt.setup)
          && (!filt.watch || wl.includes(r.symbol))
          && (!q || r.symbol.toLowerCase().includes(q) || (r.sector || "").toLowerCase().includes(q))));
      };
      el.querySelector("#sc-sector").addEventListener("change", (e) => { filt.sector = e.target.value; apply(); });
      el.querySelector("#sc-setup").addEventListener("change", (e) => { filt.setup = e.target.value; apply(); });
      el.querySelector("#sc-watch").addEventListener("click", (e) => { filt.watch = !filt.watch; e.currentTarget.setAttribute("aria-pressed", String(filt.watch)); apply(); });
      document.addEventListener("sm:watchlist", () => { if (filt.watch && document.body.contains(tableEl)) apply(); });
      ui.bindSeg(el, "dir", (v) => { filt.dir = v; apply(); });
      ui.bindSeg(el, "sctf", (v) => { SM.state.scanTf = v; SM.render(); });
      el.querySelectorAll("[data-st]").forEach((b) => b.addEventListener("click", () => {
        el.querySelectorAll("[data-st]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        filt.status = b.dataset.st; apply();
      }));
      el.querySelector("#sc-q").addEventListener("input", SM.debounce((e) => { filt.q = e.target.value; apply(); }, 150));
    },
  };

  function scannerColumns() {
    const minC = SM.state.meta.min_conf, minZ = SM.state.meta.min_zone;
    return [
      { key: "symbol", label: "Symbol", sortValue: (r) => r.symbol, render: (r) => `${SM.watchlist.star(r.symbol)}<span class="sym" title="${esc(r.name)} · ${esc(r.sector)}">${esc(r.symbol)}</span>` },
      { key: "price", label: "Price", num: true, render: (r) => SM.fmt(r.price) },
      { key: "change_pct", label: "Chg", num: true, render: (r) => ui.chg(r.change_pct) },
      { key: "timeframe", label: "TF", sm: false },
      { key: "structure", label: "Structure", render: (r) => ui.trendBadge(r.structure) },
      { key: "setup_type", label: "Setup", sm: false, render: (r) => r.setup_type ? `<span title="From confirmed structure: trend and the last BOS / CHoCH">${esc(r.setup_type)}</span>` : "—" },
      { key: "last_pivot", label: "Last pivot", sm: false, sortValue: (r) => r.last_pivot && r.last_pivot.time, render: (r) => r.last_pivot ? `<b>${esc(r.last_pivot.label)}</b> ${SM.fmt(r.last_pivot.price)} <span class="muted">${SM.dateShort(r.last_pivot.time)}</span>` : "—" },
      { key: "structure_event", label: "BOS/CHoCH", sm: false, render: (r) => r.structure_event ? `<span class="${r.structure_event.startsWith("Bullish") ? "up" : "down"}">${esc(r.structure_event.replace("CHOCH", "CHoCH"))}</span>` : "—" },
      { key: "zone", label: "Zone", render: (r) => r.zone ? `<span class="${r.zone_type === "DEMAND" ? "up" : "down"}">${esc(r.zone)}</span>` : "—" },
      { key: "freshness", label: "Freshness", sm: false, render: (r) => r.freshness ? ui.status(r.freshness) : "—" },
      { key: "zone_score", label: "Zone score", num: true, render: (r) => ui.scoreChip(r.zone_score, minZ) },
      { key: "poc", label: "POC", num: true, sm: false, render: (r) => r.poc ? `${SM.fmt(r.poc, 0)} <span class="muted">${esc(r.poc_relation || "")}</span>` : "—" },
      { key: "positioning", label: "Positioning", sm: false, render: (r) => ui.status(r.positioning) },
      { key: "oi_state", label: "OI state", render: (r) => r.oi_state === "UNAVAILABLE" ? ui.status("UNAVAILABLE") : `<span class="${/LONG BUILD|SHORT COVER/.test(r.oi_state) ? "up" : /SHORT BUILD|LONG UNWIND/.test(r.oi_state) ? "down" : "muted"}">${esc(SM.title(r.oi_state))}</span>` },
      { key: "pcr", label: "PCR", num: true, sm: false, render: (r) => SM.isNum(r.pcr) ? SM.fmt(r.pcr, 2) : "—" },
      { key: "pattern", label: "Pattern", render: (r) => r.pattern ? esc(SM.title(r.pattern)) : '<span class="muted">—</span>' },
      { key: "rr", label: "R:R", num: true, render: (r) => SM.isNum(r.rr) ? "1:" + SM.fmt(r.rr, 1) : "—" },
      { key: "confluence", label: "Confluence", num: true, render: (r) => ui.scoreChip(r.confluence, minC) },
      { key: "status", label: "Status", sortValue: (r) => ({ READY: 5, ACTIVE: 4, WAIT: 3, WATCH: 2, REJECTED: 1 })[r.status], render: (r) => `<span title="${esc(r.reason || "All rules passed")}">${ui.status(r.status)}</span>` },
      { key: "direction", label: "Dir", render: (r) => ui.dirBadge(r.direction) },
    ];
  }
  SM.parts = SM.parts || {};
  SM.parts.scannerColumns = scannerColumns;
})();
