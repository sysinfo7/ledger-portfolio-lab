"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import {
  Activity, ArrowDownLeft, ArrowRight, ArrowUpRight, BarChart3,
  BookOpen, Check, ChevronDown, CircleHelp, Clock3, Download, Layers3,
  Menu, Plus, RefreshCw, Search, Sparkles, TrendingUp, Wallet,
  X,
} from "lucide-react";

type Account = { id: string; name: string; initialCash: number; mode: Mode };
type Mode = "synthetic" | "live";
type Quote = { symbol: string; name: string; price: number; previousClose: number; changePercent: number; timestamp: string; source: string; stale: boolean };
type Holding = { symbol: string; quantity: number; averageCost: number; price: number; value: number; costBasis: number; gain: number };
type Trade = { id: string; symbol: string; side: "buy" | "sell"; quantity: number; price: number; createdAt: string };
type HistoryPoint = { date: string; value: number; invested: number };
type Candle = { date: string; close: number };
type Suggestion = { symbol: string; title: string; reason: string; score: number };
type StateData = {
  accounts: Account[]; account: Account;
  quotes: Quote[]; holdings: Holding[]; trades: Trade[]; history: HistoryPoint[];
  candles: Candle[]; suggestions: Suggestion[];
  summary: { initialInvestment: number; marketValue: number; cash: number; totalValue: number; totalGain: number; totalGainPercent: number };
  market: { mode: Mode; configured: boolean; message?: string; asOf?: string };
};
type Preferences = { mode: Mode; accounts: Partial<Record<Mode, string>>; symbol: string };
const PREFERENCES_KEY = "ledger-paper-preferences-v1";

const money = (n = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);
const compactMoney = (n = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);
const pct = (n = 0) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const shortDate = (value: string) => {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const rangeDate = (value: string) => {
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const timeAgo = (value?: string) => {
  if (!value) return "Waiting for update";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return "Updated recently";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
};

export default function Home() {
  const [data, setData] = useState<StateData | null>(null);
  const [mode, setMode] = useState<Mode>("synthetic");
  const [accountId, setAccountId] = useState("");
  const [accountIds, setAccountIds] = useState<Partial<Record<Mode, string>>>({});
  const [symbol, setSymbol] = useState("AAPL");
  const [loadedSymbol, setLoadedSymbol] = useState("");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tradeSide, setTradeSide] = useState<"buy" | "sell">("buy");
  const [quantity, setQuantity] = useState("1");
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<"account" | "generate" | null>(null);
  const [accountName, setAccountName] = useState("");
  const [initialCash, setInitialCash] = useState("100000");
  const [days, setDays] = useState("365");
  const [seed, setSeed] = useState("2026");
  const [historyConfirmed, setHistoryConfirmed] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [chartRange, setChartRange] = useState("ALL");
  const [todayLabel, setTodayLabel] = useState("");
  const [fallbackNotice, setFallbackNotice] = useState("");
  const seq = useRef(0);
  const tradeAttempt = useRef<{ fingerprint: string; requestId: string } | null>(null);
  const errorOrigin = useRef<"action" | "load" | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFERENCES_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<Preferences>;
        if (saved.mode === "synthetic" || saved.mode === "live") setMode(saved.mode);
        if (saved.accounts && typeof saved.accounts === "object") {
          const accounts: Partial<Record<Mode, string>> = {};
          for (const candidate of ["synthetic", "live"] as const) {
            const id = saved.accounts[candidate];
            if (typeof id === "string") accounts[candidate] = id;
          }
          setAccountIds(accounts);
          setAccountId(accounts[saved.mode === "live" ? "live" : "synthetic"] || "");
        }
        if (typeof saved.symbol === "string" && /^[A-Z][A-Z0-9.-]{0,9}$/.test(saved.symbol)) setSymbol(saved.symbol);
      }
    } catch { /* Storage can be disabled by browser policy. */ }
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    try { window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ mode, accounts: accountIds, symbol } satisfies Preferences)); }
    catch { /* Preferences are optional when storage is unavailable or full. */ }
  }, [preferencesReady, mode, accountIds, symbol]);

  useEffect(() => {
    setTodayLabel(new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(new Date()).toUpperCase());
  }, []);

  useEffect(() => {
    if (!dialog) return;
    const first = dialogRef.current?.querySelector<HTMLElement>("input, select, button");
    first?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setDialog(null); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>("input:not(:disabled), select:not(:disabled), button:not(:disabled), a[href], [tabindex='0']"));
      if (!items.length) return;
      const firstItem = items[0], lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) { event.preventDefault(); lastItem.focus(); }
      else if (!event.shiftKey && document.activeElement === lastItem) { event.preventDefault(); firstItem.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dialog]);

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!preferencesReady) return;
    const requestNo = ++seq.current;
    if (!opts?.quiet) setLoading(true);
    try {
      const params = new URLSearchParams({ mode, symbol });
      if (accountId) params.set("accountId", accountId);
      const response = await fetch(`/api/state?${params}`, { cache: "no-store" });
      const body = await response.json() as StateData & { error?: string };
      if (!response.ok) {
        if (response.status === 404 && accountId) {
          if (requestNo === seq.current) {
            setAccountIds((previous) => ({ ...previous, [mode]: "" }));
            setAccountId("");
            setData(null);
            setFallbackNotice(`The saved ${mode} account is no longer available. Showing the default account.`);
          }
          return;
        }
        throw new Error(body.error || "Could not load your paper portfolio.");
      }
      if (body.account?.mode !== mode || body.market?.mode !== mode) {
        if (requestNo === seq.current) {
          setData(null);
          throw new Error(`The ${mode} market response was unavailable. No data from another mode was shown.`);
        }
        return;
      }
      if (requestNo !== seq.current) return;
      setData(body as StateData);
      setLoadedSymbol(symbol);
      if (errorOrigin.current === "load") { setError(""); errorOrigin.current = null; }
      if (body.account?.id && body.account.id !== accountId) {
        setAccountId(body.account.id);
        setAccountIds((previous) => ({ ...previous, [mode]: body.account.id }));
      }
      if (body.account?.mode && body.account.mode !== mode && !accountId) setMode(body.account.mode);
    } catch (err) {
      if (requestNo === seq.current) { setError(err instanceof Error ? err.message : "Unable to reach the market service."); errorOrigin.current = "load"; }
    } finally {
      if (requestNo === seq.current) setLoading(false);
    }
  }, [accountId, mode, symbol, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    void load();
    const timer = window.setInterval(() => void load({ quiet: true }), mode === "live" ? 15000 : 30000);
    return () => { window.clearInterval(timer); seq.current += 1; };
  }, [load, mode, preferencesReady]);

  const post = async (payload: Record<string, unknown>, context = { accountId, mode }) => {
    const response = await fetch("/api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...context }) });
    const body = await response.json() as { error?: string; accountId?: string; ok?: boolean };
    if (!response.ok) throw Object.assign(new Error(body.error || "That action could not be completed."), { status: response.status });
    return body;
  };

  const performTrade = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(quantity);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter a quantity greater than zero."); errorOrigin.current = "action"; return; }
    const context = { accountId, mode };
    const trade = { action: "trade", symbol, side: tradeSide, quantity: amount };
    const fingerprint = JSON.stringify({ ...trade, ...context });
    if (!tradeAttempt.current || tradeAttempt.current.fingerprint !== fingerprint) {
      tradeAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    setBusy(true); setError(""); errorOrigin.current = null; setNotice("");
    try {
      await post({ ...trade, requestId: tradeAttempt.current.requestId }, context);
      tradeAttempt.current = null;
      setNotice(`${tradeSide === "buy" ? "Bought" : "Sold"} ${amount} ${symbol} on paper.`);
      await load({ quiet: true });
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 409) tradeAttempt.current = null;
      setError(err instanceof Error ? err.message : "Trade failed."); errorOrigin.current = "action";
    }
    finally { setBusy(false); }
  };

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); errorOrigin.current = null;
    try {
      const result = await post({ action: "create", name: accountName.trim(), initialCash: Number(initialCash) });
      if (!result.accountId) throw new Error("The account was created but no account ID was returned.");
      setAccountId(result.accountId); setAccountIds((previous) => ({ ...previous, [mode]: result.accountId })); setData(null); setAccountName(""); setDialog(null); setNotice("Your paper account is ready.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create the account."); errorOrigin.current = "action"; }
    finally { setBusy(false); }
  };

  const generateHistory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); errorOrigin.current = null;
    try {
      if (!historyConfirmed || mode !== "synthetic") throw new Error("Confirm the synthetic portfolio reset before generating history.");
      await post({ action: "generate", days: Math.min(1825, Math.max(30, Number(days))), seed: Number(seed) || 2026, confirmReset: true });
      setDialog(null); setHistoryConfirmed(false); setNotice("Synthetic history generated. The selected synthetic portfolio was reset."); await load({ quiet: true });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not generate history."); errorOrigin.current = "action"; }
    finally { setBusy(false); }
  };

  const snapshot = async () => {
    setBusy(true); setError(""); errorOrigin.current = null;
    try { await post({ action: "snapshot" }); setNotice("Portfolio snapshot saved."); await load({ quiet: true }); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save a snapshot."); errorOrigin.current = "action"; }
    finally { setBusy(false); }
  };

  const exportData = (format: "csv" | "json") => {
    if (!data) return;
    let contents: string, type: string, extension: string;
    if (format === "json") { contents = JSON.stringify({ account: data.account, history: data.history, trades: data.trades }, null, 2); type = "application/json"; extension = "json"; }
    else {
      const rows = [["date", "portfolio_value", "invested"], ...data.history.map((row) => [row.date, row.value, row.invested])];
      contents = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n"); type = "text/csv"; extension = "csv";
    }
    const url = URL.createObjectURL(new Blob([contents], { type }));
    const link = document.createElement("a"); link.href = url; link.download = `${(data.account?.name || "paper-portfolio").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-history.${extension}`; link.click(); URL.revokeObjectURL(url);
  };

  const quote = data?.quotes?.find((item) => item.symbol === symbol);
  const suggestions = data?.suggestions ?? [];
  const visibleHistory = useMemo(() => {
    if (!data?.history) return [];
    if (chartRange === "1M") return data.history.slice(-30);
    if (chartRange === "1Y") return data.history.slice(-365);
    return data.history;
  }, [data?.history, chartRange]);
  const filteredSymbols = useMemo(() => {
    const all = data?.quotes ?? [];
    const query = search.trim().toLowerCase();
    return query ? all.filter((q) => `${q.symbol} ${q.name}`.toLowerCase().includes(query)) : all;
  }, [data?.quotes, search]);
  const period = visibleHistory.length > 1 ? ((visibleHistory.at(-1)!.value - visibleHistory[0].value) / (visibleHistory[0].value || 1)) * 100 : 0;
  const spansLongHistory = visibleHistory.length > 1 && (new Date(visibleHistory.at(-1)!.date).getTime() - new Date(visibleHistory[0].date).getTime()) > 366 * 24 * 60 * 60 * 1000;
  const openGenerator = () => { setError(""); errorOrigin.current = null; setHistoryConfirmed(false); setDialog("generate"); };
  const switchMode = (nextMode: Mode) => {
    if (busy) return;
    if (nextMode === mode) return;
    setData(null);
    setAccountId(accountIds[nextMode] || "");
    setMode(nextMode);
    setDialog(null);
    setError("");
    errorOrigin.current = null;
    setNotice("");
  };

  if (!preferencesReady) return <main className="app-shell preferences-loading" aria-live="polite">Loading your workspace…</main>;

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark"><Activity size={18} strokeWidth={2.4} /></div><div><b>Ledger</b><span>Paper markets</span></div><button className="icon-button mobile-close" aria-label="Close menu" onClick={() => setMobileMenu(false)}><X size={18} /></button></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="nav-list" aria-label="Main navigation">
          <a className="nav-item active" href="#overview"><Layers3 size={17} />Overview</a>
          <a className="nav-item" href="#holdings"><Wallet size={17} />Portfolio</a>
          <a className="nav-item" href="#markets"><BarChart3 size={17} />Markets</a>
          <a className="nav-item" href="#activity"><Clock3 size={17} />Activity</a>
        </nav>
        <div className="side-divider" />
        <div className="section-row"><span className="workspace-label">WATCHLIST</span><button className="tiny-icon" aria-label="Find a stock" onClick={() => document.getElementById("stock-search")?.focus()}><Plus size={15} /></button></div>
        <label className="search-box"><Search size={15} /><input id="stock-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search stocks" /></label>
        <div className="watchlist">
          {filteredSymbols.map((q) => <button key={q.symbol} className={`watch-row ${symbol === q.symbol ? "selected" : ""}`} onClick={() => { setSymbol(q.symbol); setMobileMenu(false); }}><span className="ticker-dot">{q.symbol.slice(0, 1)}</span><span className="watch-name"><b>{q.symbol}</b><small>{q.name}</small></span><span className="watch-price"><b>{money(q.price)}</b><small className={q.changePercent >= 0 ? "positive" : "negative"}>{pct(q.changePercent)}</small></span></button>)}
          {!filteredSymbols.length && <div className="empty-small">{data?.quotes?.length ? "No matching stocks" : "Quotes appear when the feed is available"}</div>}
        </div>
        <div className="sidebar-bottom"><div className="learn-card"><div className="learn-icon"><BookOpen size={16} /></div><b>Practice with purpose</b><p>Explore market ideas using virtual money. No real orders are placed.</p><a href="#ideas">Explore ideas <ArrowRight size={13} /></a></div><div className="profile"><div className="avatar">{(data?.account?.name || "A").slice(0, 1).toUpperCase()}</div><div className="profile-copy"><b>{data?.account?.name || "Paper trader"}</b><small>Paper account</small></div><ChevronDown size={15} className="muted-icon" /></div></div>
      </aside>

      <section className="main-area" id="overview">
        <header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={20} /></button><span className="breadcrumb">Workspace</span><span className="crumb-slash">/</span><b>Overview</b></div><div className="topbar-right"><div className={`mode-pill ${mode}`}><span />{mode === "live" ? "Live · IEX" : "Synthetic"}</div><button className="icon-button" aria-label="Refresh portfolio" onClick={() => void load()}><RefreshCw size={16} className={loading ? "spin" : ""} /></button><div className="top-avatar">{(data?.account?.name || "A").slice(0, 1).toUpperCase()}</div></div></header>

        <div className="page-content">
          <div className="page-heading"><div><div className="eyebrow">{todayLabel || "US MARKETS"} <span className="eyebrow-dot" /> US MARKETS</div><h1>Good evening, {data?.account?.name?.split(" ")[0] || "investor"}.</h1><p className="subheading">Here’s how your paper portfolio is doing.</p></div><div className="heading-actions"><label className="account-select"><span className="account-mini">{(data?.account?.name || "A").slice(0, 1).toUpperCase()}</span><select aria-label="Select paper account" value={accountId} disabled={loading || busy} onChange={(e) => { setData(null); setAccountId(e.target.value); setAccountIds((previous) => ({ ...previous, [mode]: e.target.value })); setFallbackNotice(""); }}><option value="" disabled>Select account</option>{(data?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select><ChevronDown size={14} /></label><button className="button button-light" disabled={busy} onClick={() => { setError(""); errorOrigin.current = null; setDialog("account"); }}><Plus size={15} />New account</button></div></div>

          {error && <div className="alert error-alert" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => { setError(""); errorOrigin.current = null; }}><X size={15} /></button></div>}
          {notice && <div className="alert success-alert" role="status"><Check size={15} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={15} /></button></div>}
          {fallbackNotice && <div className="alert info-alert" role="status"><CircleHelp size={16} /><span>{fallbackNotice}</span><button aria-label="Dismiss message" onClick={() => setFallbackNotice("")}><X size={15} /></button></div>}
          {data?.market?.message && data.candles?.length > 0 && <div className="alert info-alert" role="status"><CircleHelp size={16} /><span>{data.market.message}</span></div>}
          {mode === "live" && data?.market?.configured === false && !data.market.message && <div className="alert info-alert"><CircleHelp size={16} /><span>Live quotes aren’t configured on the server. Switch to synthetic mode to keep practicing.</span></div>}
          {data && !data.candles?.length && data.market?.message && <div className="alert info-alert" role="status"><CircleHelp size={16} /><span>Historical chart unavailable: {data.market.message}</span></div>}

          <div className="mode-strip"><div className="mode-strip-copy"><span className={`mode-indicator ${mode}`}><Activity size={15} /></span><div><b>{mode === "live" ? "Live market data" : "Synthetic practice mode"}</b><span>{mode === "live" ? "Alpaca IEX feed · partial market coverage" : "Seeded market history · simulated quotes and trades"}</span></div></div><div className="mode-switch" role="group" aria-label="Market data mode"><button disabled={busy} className={mode === "synthetic" ? "active" : ""} onClick={() => switchMode("synthetic")}>Synthetic</button><button disabled={busy} className={mode === "live" ? "active" : ""} onClick={() => switchMode("live")}>Live feed</button></div></div>

          <section className="metric-grid" aria-label="Portfolio summary">
            <article className="metric-card primary-metric"><div className="metric-top"><span>Portfolio value</span><span className="metric-icon"><Wallet size={16} /></span></div><div className="metric-number">{data ? money(data.summary.totalValue) : "—"}</div><div className={`metric-foot ${period >= 0 ? "positive" : "negative"}`}><span className="metric-trend"><TrendingUp size={14} />{data ? pct(period) : "—"}</span><span>over selected period</span></div></article>
            <article className="metric-card"><div className="metric-top"><span>Total return</span><span className="metric-icon gain-icon"><ArrowUpRight size={17} /></span></div><div className={`metric-number ${data?.summary?.totalGainPercent !== undefined && data.summary.totalGainPercent < 0 ? "negative" : ""}`}>{data ? money(data.summary.totalGain) : "—"}</div><div className="metric-foot"><span className={`return-badge ${(data?.summary?.totalGainPercent ?? 0) >= 0 ? "good" : "bad"}`}>{data ? pct(data.summary.totalGainPercent) : "—"}</span><span>since start</span></div></article>
            <article className="metric-card"><div className="metric-top"><span>Invested</span><span className="metric-icon"><ArrowUpRight size={16} /></span></div><div className="metric-number">{data ? money(data.summary.initialInvestment) : "—"}</div><div className="metric-foot"><span className="neutral-badge">Initial capital</span><span>starting balance</span></div></article>
            <article className="metric-card"><div className="metric-top"><span>Available cash</span><span className="metric-icon"><Wallet size={16} /></span></div><div className="metric-number">{data ? money(data.summary.cash) : "—"}</div><div className="metric-foot"><span className="neutral-badge">{data?.holdings?.length ?? 0} positions</span><span>ready to invest</span></div></article>
          </section>

          <section className="content-grid">
            <div className="left-column">
              <article className="panel portfolio-panel"><div className="panel-header"><div><div className="panel-title-row"><h2>Portfolio performance</h2><span className="live-dot" /></div><p>Account value compared with your invested capital</p></div><div className="panel-controls"><button className="icon-button export-button" title="Export history as CSV" onClick={() => exportData("csv")}><Download size={15} /><span>Export</span></button><div className="range-tabs">{["1M", "1Y", "ALL"].map((range) => <button key={range} className={chartRange === range ? "active" : ""} onClick={() => setChartRange(range)}>{range}</button>)}</div></div></div><div className="chart-legend"><span><i className="legend-line value-line" />Portfolio value</span><span><i className="legend-line invested-line" />Invested</span><span className="chart-period">{visibleHistory.length > 0 ? `${rangeDate(visibleHistory[0].date)} — ${rangeDate(visibleHistory.at(-1)!.date)}` : "No history yet"}</span></div><div className="portfolio-chart">{visibleHistory.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={visibleHistory} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}><defs><linearGradient id="portfolioFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#159b72" stopOpacity={0.2} /><stop offset="95%" stopColor="#159b72" stopOpacity={0.01} /></linearGradient></defs><CartesianGrid vertical={false} stroke="#edf0ef" /><XAxis dataKey="date" tickFormatter={(value) => spansLongHistory ? rangeDate(String(value)) : shortDate(String(value))} axisLine={false} tickLine={false} tick={{ fill: "#8a9492", fontSize: 11 }} minTickGap={36} /><YAxis tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fill: "#8a9492", fontSize: 11 }} width={54} domain={["auto", "auto"]} /><Tooltip formatter={(value, name) => [money(Number(value)), name === "value" ? "Portfolio value" : "Invested"]} labelFormatter={(label) => rangeDate(String(label))} contentStyle={{ borderRadius: 10, border: "1px solid #e8eeeb", boxShadow: "0 8px 24px #142d2618", fontSize: 12 }} /><Area type="monotone" dataKey="value" stroke="#138d69" strokeWidth={2.5} fill="url(#portfolioFill)" activeDot={{ r: 4, fill: "#138d69", strokeWidth: 0 }} /><Line type="monotone" dataKey="invested" stroke="#a8b3af" strokeWidth={1.5} strokeDasharray="5 5" dot={false} activeDot={false} /></AreaChart></ResponsiveContainer> : <div className="chart-empty"><BarChart3 size={21} /><b>No portfolio history yet</b><span>{mode === "live" ? "Portfolio history will appear after activity in the live account." : "Make a paper trade or generate long-term test data to begin."}</span>{mode === "synthetic" && <button className="text-button" onClick={openGenerator}>Generate sample history <ArrowRight size={14} /></button>}</div>}</div><div className="chart-note"><span><Clock3 size={13} />{data?.history?.length ? `${data.history.length} daily snapshots` : "History updates after account activity"}</span>{mode === "synthetic" && <button className="link-button" onClick={openGenerator}>Generate history</button>}</div></article>

              <article className="panel holdings-panel" id="holdings"><div className="panel-header"><div><h2>Your holdings</h2><p>Positions in {data?.account?.name || "your account"}</p></div><button className="link-button" onClick={() => document.getElementById("trade-card")?.scrollIntoView({ behavior: "smooth" })}>Trade a stock <ArrowRight size={14} /></button></div>{data?.holdings?.length ? <div className="table-scroll"><table><thead><tr><th>ASSET</th><th>QUANTITY</th><th>AVG. COST</th><th>PRICE</th><th>MARKET VALUE</th><th>RETURN</th></tr></thead><tbody>{data.holdings.map((holding) => <tr key={holding.symbol} onClick={() => setSymbol(holding.symbol)}><td><div className="asset-cell"><span className="asset-logo">{holding.symbol.slice(0, 1)}</span><div><b>{holding.symbol}</b><small>{data.quotes.find((q) => q.symbol === holding.symbol)?.name || "Equity"}</small></div></div></td><td>{holding.quantity.toLocaleString()}</td><td>{money(holding.averageCost)}</td><td>{money(holding.price)}</td><td className="strong-cell">{money(holding.value)}</td><td><span className={`table-return ${holding.gain >= 0 ? "positive" : "negative"}`}>{holding.gain >= 0 ? "+" : ""}{money(holding.gain)}</span></td></tr>)}</tbody></table></div> : <div className="holdings-empty"><div className="empty-illustration"><Wallet size={19} /></div><div><b>Your portfolio is ready for its first trade</b><span>Choose a stock from your watchlist and make a paper trade to see it here.</span></div><button className="button button-dark" onClick={() => document.getElementById("trade-card")?.scrollIntoView({ behavior: "smooth" })}>Explore stocks <ArrowRight size={14} /></button></div>}</article>
            </div>

            <div className="right-column">
              <article className="panel trade-panel" id="trade-card"><div className="trade-header"><div><span className="eyebrow">PAPER TRADING</span><h2>Place a trade</h2></div><span className="trade-shield"><Layers3 size={17} /></span></div><label className="field-label" htmlFor="trade-symbol">Stock</label><div className="stock-select"><span className="stock-avatar">{symbol.slice(0, 1)}</span><select id="trade-symbol" value={symbol} disabled={loading || !data} onChange={(e) => setSymbol(e.target.value)}>{(data?.quotes ?? []).map((q) => <option key={q.symbol} value={q.symbol}>{q.symbol} · {q.name}</option>)}{!data?.quotes?.some((q) => q.symbol === symbol) && <option value={symbol}>{symbol}</option>}</select><ChevronDown size={15} /></div><div className="selected-quote"><div><span>Market price</span><b>{quote ? money(quote.price) : "—"}</b></div><span className={`quote-change ${quote && quote.changePercent >= 0 ? "positive" : "negative"}`}><ArrowUpRight size={13} />{quote ? pct(quote.changePercent) : "—"}</span></div><div className="trade-segment" role="group" aria-label="Trade action"><button type="button" className={tradeSide === "buy" ? "buy-selected" : ""} disabled={loading || !data} onClick={() => setTradeSide("buy")}><ArrowDownLeft size={15} />Buy</button><button type="button" className={tradeSide === "sell" ? "sell-selected" : ""} disabled={loading || !data} onClick={() => setTradeSide("sell")}><ArrowUpRight size={15} />Sell</button></div><form onSubmit={performTrade}><label className="field-label" htmlFor="quantity">Quantity</label><div className="quantity-field"><input id="quantity" inputMode="decimal" type="number" min="0.0001" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /></div><div className="estimated-row"><span>Estimated {tradeSide === "buy" ? "cost" : "proceeds"}</span><b>{money((Number(quantity) || 0) * (quote?.price || 0))}</b></div><button className={`button trade-submit ${tradeSide === "sell" ? "sell-button" : ""}`} type="submit" disabled={busy || loading || !quote || quote.stale}>{busy ? "Processing…" : `${tradeSide === "buy" ? "Buy" : "Sell"} ${symbol}`}</button></form><div className="trade-disclaimer"><CircleHelp size={13} />Trades use {mode === "live" ? "IEX feed" : "simulated"} prices and never reach a broker.</div></article>

              <article className="panel stock-panel" id="markets"><div className="panel-header stock-panel-head"><div><span className="eyebrow">MARKET SNAPSHOT</span><h2>{symbol} <span className="stock-full-name">{quote?.name || "Stock"}</span></h2></div><div className="quote-freshness"><span className={!quote ? "freshness-dot unavailable" : quote.stale ? "freshness-dot stale" : "freshness-dot"} />{!quote ? "Unavailable" : `${quote.stale ? "Stale" : "Fresh"} · ${rangeDate(quote.timestamp)} · ${timeAgo(quote.timestamp)}`}</div></div><div className="stock-price-row"><div><b>{quote ? money(quote.price) : "—"}</b><span className={quote && quote.changePercent >= 0 ? "positive" : "negative"}>{quote ? `${quote.changePercent >= 0 ? "+" : ""}${money(quote.price - quote.previousClose)} (${pct(quote.changePercent)})` : "Quote unavailable"}</span></div><div className="stock-chart-icon"><TrendingUp size={18} /></div></div><div className="stock-chart">{data && loadedSymbol === symbol && data.candles?.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={data.candles} margin={{ top: 5, right: 2, left: 2, bottom: 0 }}><defs><linearGradient id="stockStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#9acfb8" /><stop offset="100%" stopColor="#158d69" /></linearGradient></defs><Line type="monotone" dataKey="close" stroke="url(#stockStroke)" strokeWidth={2.2} dot={false} activeDot={{ r: 3, fill: "#158d69", strokeWidth: 0 }} /><Tooltip formatter={(value) => [money(Number(value)), "Close"]} labelFormatter={(label) => rangeDate(String(label))} contentStyle={{ borderRadius: 8, border: "1px solid #e8eeeb", fontSize: 11 }} /><XAxis dataKey="date" hide /><YAxis domain={["dataMin", "dataMax"]} hide /></LineChart></ResponsiveContainer> : <div className="stock-chart-empty">Price history will show when available</div>}</div><div className="stock-chart-footer"><span>{mode === "live" ? data?.market?.asOf ? `Feed updated ${rangeDate(data.market.asOf)} · ${timeAgo(data.market.asOf)}` : quote?.timestamp ? `Quote ${rangeDate(quote.timestamp)} · ${timeAgo(quote.timestamp)}` : "Waiting for live IEX data" : "Synthetic daily closes"}</span><span>{quote?.source || (mode === "live" ? "Alpaca IEX" : "Practice data")}</span></div></article>

              <article className="panel ideas-panel" id="ideas"><div className="panel-header"><div><div className="ideas-title"><span className="ideas-spark"><Sparkles size={14} /></span><h2>Ideas to explore</h2></div><p>Rule-based learning prompts</p></div><button className="tiny-icon" title="About suggestions"><CircleHelp size={15} /></button></div>{suggestions.length ? <div className="suggestion-list">{suggestions.slice(0, 3).map((item) => <button className="suggestion" key={item.symbol} onClick={() => setSymbol(item.symbol)}><span className="suggestion-symbol">{item.symbol.slice(0, 1)}</span><span className="suggestion-copy"><b>{item.symbol} · {item.title}</b><small>{item.reason}</small></span><ArrowRight size={14} /></button>)}</div> : <div className="suggestion-empty">Suggestions will appear when market data is available.</div>}<div className="ideas-footnote"><CircleHelp size={13} /><span>Educational prompts based on simple signals. They aren’t forecasts or financial advice.</span></div></article>
            </div>
          </section>

          <section className="panel activity-panel" id="activity"><div className="panel-header"><div><h2>Recent activity</h2><p>Your latest paper trades</p></div><div className="activity-actions"><button className="link-button" onClick={() => exportData("json")}><Download size={14} /> Export JSON</button><button className="button button-light compact" onClick={() => void snapshot()} disabled={busy}><Plus size={14} />Save snapshot</button></div></div>{data?.trades?.length ? <div className="table-scroll"><table><thead><tr><th>TYPE</th><th>ASSET</th><th>DATE</th><th>SHARES</th><th>PRICE</th><th>AMOUNT</th></tr></thead><tbody>{data.trades.slice(0, 6).map((trade) => <tr key={trade.id}><td><span className={`trade-type ${trade.side}`}><span />{trade.side}</span></td><td><b>{trade.symbol}</b></td><td>{new Date(trade.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</td><td>{trade.quantity}</td><td>{money(trade.price)}</td><td className="strong-cell">{money(trade.price * trade.quantity)}</td></tr>)}</tbody></table></div> : <div className="activity-empty"><Clock3 size={17} /><span>No trades yet. Your paper orders will appear here.</span></div>}</section>
          <footer className="page-footer"><span>Ledger Paper Markets · Data for learning purposes</span><span><span className="footer-status" />{data?.market?.asOf ? `Last updated ${timeAgo(data.market.asOf)}` : "Connected to practice ledger"}</span><button onClick={() => { setError(""); void load(); }}>Refresh data</button></footer>
        </div>
      </section>

      {mobileMenu && <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileMenu(false)} />}
      {dialog && <div ref={dialogRef} className="dialog-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setDialog(null); }}><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><div className="dialog-head"><div><span className="eyebrow">{dialog === "account" ? "YOUR WORKSPACE" : "TEST DATA"}</span><h2 id="dialog-title">{dialog === "account" ? "Create a paper account" : "Generate long-term history"}</h2></div><button className="icon-button" aria-label="Close dialog" onClick={() => setDialog(null)}><X size={18} /></button></div>{dialog === "account" ? <form onSubmit={createAccount}><p className="dialog-copy">Set up a named portfolio for a demo or classroom exercise. No password is needed.</p><label className="field-label" htmlFor="account-name">Account name</label><input className="text-input" id="account-name" value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="e.g. Morgan’s demo" maxLength={40} required autoFocus /><label className="field-label dialog-label" htmlFor="starting-cash">Starting cash</label><div className="money-input"><span>$</span><input id="starting-cash" type="number" min="100" max="10000000" step="100" value={initialCash} onChange={(e) => setInitialCash(e.target.value)} required /></div><div className="dialog-actions"><button type="button" className="button button-light" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}<ArrowRight size={15} /></button></div></form> : <form onSubmit={generateHistory}><p className="dialog-copy">Generate a reproducible synthetic price path and long-term portfolio history. This will reset trades, holdings, cash, and history for the selected synthetic account only. Other accounts and all live accounts are unchanged.</p><label className="field-label" htmlFor="history-days">History length</label><div className="select-field"><select id="history-days" value={days} onChange={(e) => setDays(e.target.value)}><option value="30">30 days · 1 month</option><option value="90">90 days · 3 months</option><option value="365">365 days · 1 year</option><option value="1095">1,095 days · 3 years</option><option value="1825">1,825 days · 5 years</option></select><ChevronDown size={15} /></div><label className="field-label dialog-label" htmlFor="history-seed">Random seed</label><input className="text-input" id="history-seed" type="number" value={seed} onChange={(e) => setSeed(e.target.value)} /><p className="form-hint">Using the same seed recreates the same market path.</p><label className="confirm-reset"><input type="checkbox" checked={historyConfirmed} onChange={(e) => setHistoryConfirmed(e.target.checked)} /><span>I understand this resets the selected synthetic portfolio.</span></label><div className="dialog-actions"><button type="button" className="button button-light" onClick={() => setDialog(null)}>Cancel</button><button className="button button-dark" type="submit" disabled={busy || !historyConfirmed || mode !== "synthetic"}>{busy ? "Generating…" : "Reset & generate"}<Sparkles size={15} /></button></div></form>}</section></div>}
    </main>
  );
}
