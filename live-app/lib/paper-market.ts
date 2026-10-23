import { env } from "cloudflare:workers";

export const UNIVERSE = [
  { symbol: "AAPL", name: "Apple" }, { symbol: "MSFT", name: "Microsoft" },
  { symbol: "NVDA", name: "NVIDIA" }, { symbol: "AMZN", name: "Amazon" },
  { symbol: "GOOGL", name: "Alphabet" }, { symbol: "META", name: "Meta" },
  { symbol: "TSLA", name: "Tesla" }, { symbol: "SPY", name: "SPDR S&P 500 ETF" },
  { symbol: "QQQ", name: "Invesco QQQ Trust" }, { symbol: "JPM", name: "JPMorgan Chase" },
];
export type Mode = "synthetic" | "live";
type Trade = { id: string; symbol: string; side: "buy" | "sell"; quantity: number; price: number; createdAt: string; requestId?: string };
type State = { cash: number; trades: Trade[]; seed: number; days: number; inception: string };
type AccountRow = { id: string; name: string; mode: Mode; initial_cash: number; version: number; state_json: string };
const startPrices: Record<string, number> = { AAPL: 232, MSFT: 510, NVDA: 184, AMZN: 228, GOOGL: 245, META: 718, TSLA: 455, SPY: 665, QQQ: 600, JPM: 310 };
const quoteCache = new Map<string, { at: number; value: Quote }>();
const candleCache = new Map<string, { at: number; value: Array<{ date: string; close: number }> }>();
const pricePaths = new Map<string, { past: number[]; future: number[] }>();
const syntheticEpoch = Date.UTC(2025, 0, 1);
type Quote = { symbol: string; name: string; price: number; previousClose: number; changePercent: number; timestamp: string; source: string; stale: boolean };
const now = () => new Date().toISOString();
const money = (n: number) => Math.round(n * 100) / 100;
const todayString = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const easternTradeDate = (createdAt: string) => {
  const stamp = Date.parse(createdAt);
  return Number.isFinite(stamp) ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(stamp)) : createdAt.slice(0, 10);
};
const err = (message: string, status = 400) => Object.assign(new Error(message), { status });
function database(): D1Database {
  if (!env.DB) throw err("D1 binding DB is unavailable. Apply the generated database migration and configure DB on the Worker.", 503);
  return env.DB;
}
function modeValue(value: string | null | undefined): Mode {
  if (value === "synthetic" || value === "live") return value;
  throw err("mode must be synthetic or live");
}
function finite(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw err(`${name} must be between ${min} and ${max}`);
  return value;
}
function parse(row: AccountRow): State {
  try { return JSON.parse(row.state_json) as State; } catch { throw err("Stored account data is invalid", 500); }
}
function id() { return crypto.randomUUID(); }
function hash(value: string): number {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
}
function random(seed: string) { return hash(seed) / 0xffffffff; }
export function syntheticClose(symbol: string, date: string, seed = 2025): number {
  const base = startPrices[symbol];
  if (!base) throw err("Unsupported symbol");
  const offset = Math.floor((Date.parse(`${date}T00:00:00Z`) - syntheticEpoch) / 86400000);
  if (!Number.isFinite(offset)) throw err("Invalid date");
  const pathKey = `${seed}:${symbol}`;
  let path = pricePaths.get(pathKey);
  if (!path) { path = { past: [base], future: [base] }; pricePaths.set(pathKey, path); }
  if (offset >= 0) {
    while (path.future.length <= offset) {
      const day = path.future.length;
      const daily = (random(`${seed}:${symbol}:${day}`) - 0.49) * 0.045;
      path.future.push(path.future[day - 1] * (1 + daily));
    }
    return money(Math.max(1, path.future[offset]));
  }
  const distance = -offset;
  while (path.past.length <= distance) {
    const day = -(path.past.length - 1);
    const daily = (random(`${seed}:${symbol}:${day}`) - 0.49) * 0.045;
    path.past.push(path.past.at(-1)! / (1 + daily));
  }
  return money(Math.max(1, path.past[distance]));
}
async function listAccounts(mode: Mode) {
  return (await database().prepare("SELECT id,name,mode,initial_cash,version,state_json FROM paper_accounts WHERE mode=? ORDER BY created_at").bind(mode).all<AccountRow>()).results ?? [];
}
async function account(idValue: string, mode: Mode): Promise<AccountRow> {
  if (!idValue) throw err("accountId is required");
  const row = await database().prepare("SELECT id,name,mode,initial_cash,version,state_json FROM paper_accounts WHERE id=? AND mode=?").bind(idValue, mode).first<AccountRow>();
  if (!row) throw err("Account not found", 404);
  return row;
}
export async function ensureSeedAccounts(mode: Mode) {
  const db = database();
  const initialCash = 100_000;
  for (const name of ["Alex", "Jordan", "Taylor"]) {
    const accountId = `demo-${mode}-${name.toLowerCase()}`;
    const timestamp = now();
    const inception = mode === "synthetic" ? dayString(new Date(Date.parse(`${todayString()}T00:00:00Z`) - 365 * 86400000)) : todayString();
    const state: State = { cash: initialCash, trades: [], seed: 2025, days: 365, inception };
    if (mode === "synthetic" && name === "Alex") {
      for (const [symbol, budget] of [["AAPL", 20_000], ["MSFT", 15_000], ["NVDA", 15_000]] as const) {
        const price = syntheticClose(symbol, inception, state.seed);
        const quantity = Math.floor((budget / price) * 10_000) / 10_000;
        state.cash = money(state.cash - quantity * price);
        state.trades.push({ id: `seed-${symbol.toLowerCase()}`, symbol, side: "buy", quantity, price, createdAt: `${inception}T14:30:00.000Z` });
      }
    }
    await db.prepare("INSERT OR IGNORE INTO paper_accounts(id,name,mode,initial_cash,version,state_json,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?)")
      .bind(accountId, name, mode, initialCash * 100, JSON.stringify(state), timestamp, timestamp).run();
  }
}
async function save(row: AccountRow, state: State) {
  const result = await database().prepare("UPDATE paper_accounts SET state_json=?,version=version+1,updated_at=? WHERE id=? AND mode=? AND version=?")
    .bind(JSON.stringify(state), now(), row.id, row.mode, row.version).run();
  return result.meta.changes === 1;
}
async function alpacaQuote(symbol: string, fresh = false): Promise<Quote> {
  const entry = UNIVERSE.find((x) => x.symbol === symbol);
  if (!entry) throw err("Unsupported symbol");
  const cached = quoteCache.get(symbol);
  if (!fresh && cached && Date.now() - cached.at < 10_000) return { ...cached.value, stale: Date.now() - Date.parse(cached.value.timestamp) >= 120_000 };
  if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw err("Live quotes are unavailable: configure ALPACA_API_KEY and ALPACA_API_SECRET. No synthetic prices are shown in live mode.", 503);
  try {
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/snapshot?feed=iex`, { headers: { "APCA-API-KEY-ID": env.ALPACA_API_KEY, "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Alpaca returned ${response.status}`);
    const data = await response.json() as { latestTrade?: { p: number; t: string }; dailyBar?: { c: number }; prevDailyBar?: { c: number } };
    const price = data.latestTrade?.p;
    const previousClose = data.prevDailyBar?.c ?? data.dailyBar?.c;
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0 || typeof previousClose !== "number" || !Number.isFinite(previousClose) || previousClose <= 0) throw new Error("No valid positive IEX snapshot price is available");
    const stamp = data.latestTrade?.t;
    const stampMs = typeof stamp === "string" ? Date.parse(stamp) : NaN;
    if (typeof stamp !== "string" || !Number.isFinite(stampMs) || stampMs > Date.now() + 60_000 || money(price) <= 0) throw new Error("IEX snapshot has no valid current latest-trade timestamp and positive price");
    const value: Quote = { symbol, name: entry.name, price: money(price), previousClose: money(previousClose), changePercent: money((price / previousClose - 1) * 100), timestamp: stamp, source: "Alpaca IEX", stale: Date.now() - stampMs >= 120_000 };
    quoteCache.set(symbol, { at: Date.now(), value });
    return value;
  } catch (e) {
    if (cached) return { ...cached.value, stale: Date.now() - Date.parse(cached.value.timestamp) >= 120_000 };
    throw err(`Live quote unavailable for ${symbol}: ${e instanceof Error ? e.message : "request failed"}. Check Alpaca credentials and market data access.`, 503);
  }
}
async function quotesFor(mode: Mode, symbols = UNIVERSE.map((x) => x.symbol), seed = 2025): Promise<Quote[]> {
  if (mode === "live") return Promise.all(symbols.map((s) => alpacaQuote(s)));
  const date = todayString();
  return symbols.map((symbol) => {
    const previousClose = syntheticClose(symbol, dayString(new Date(Date.parse(`${date}T00:00:00Z`) - 86400000)), seed);
    const price = syntheticClose(symbol, date, seed);
    const item = UNIVERSE.find((x) => x.symbol === symbol)!;
    return { symbol, name: item.name, price, previousClose, changePercent: money((price / previousClose - 1) * 100), timestamp: `${date}T16:00:00.000Z`, source: "Deterministic simulation", stale: false };
  });
}
async function alpacaCandles(symbol: string, days: number) {
  if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw err("Live candles are unavailable: configure Alpaca API credentials.", 503);
  const cached = candleCache.get(`${symbol}:${days}`);
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const start = new Date(Date.now() - days * 86400000).toISOString();
  const end = new Date(Date.now() - 15 * 60_000).toISOString();
  const output: Array<{ date: string; close: number }> = [];
  let token: string | undefined;
  do {
    const query = new URLSearchParams({ timeframe: "1Day", start, end, limit: "1000", feed: "iex", sort: "asc" });
    if (token) query.set("page_token", token);
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?${query}`, { headers: { "APCA-API-KEY-ID": env.ALPACA_API_KEY, "APCA-API-SECRET-KEY": env.ALPACA_API_SECRET }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw err(`Live candles unavailable for ${symbol}: Alpaca returned ${response.status}`, 503);
    const data = await response.json() as { bars?: Array<{ t: string; c: number }>; next_page_token?: string | null };
    output.push(...(data.bars ?? []).map(bar => ({ date: bar.t.slice(0, 10), close: money(bar.c) })));
    token = data.next_page_token ?? undefined;
  } while (token && output.length < days + 10);
  candleCache.set(`${symbol}:${days}`, { at: Date.now(), value: output });
  return output;
}
function holdingsOf(trades: Trade[], quotes: Map<string, Quote>) {
  const positions = new Map<string, { quantity: number; cost: number }>();
  for (const t of trades) {
    const p = positions.get(t.symbol) ?? { quantity: 0, cost: 0 };
    if (t.side === "buy") { p.cost += t.quantity * t.price; p.quantity += t.quantity; }
    else { const avg = p.quantity ? p.cost / p.quantity : 0; p.quantity -= t.quantity; p.cost -= avg * t.quantity; }
    positions.set(t.symbol, p);
  }
  return [...positions].filter(([, p]) => p.quantity > 0.00001).map(([symbol, p]) => {
    const price = quotes.get(symbol)?.price ?? 0;
    const costBasis = money(p.cost), value = money(p.quantity * price);
    return { symbol, quantity: Math.round(p.quantity * 10_000) / 10_000, averageCost: money(p.cost / p.quantity), price, value, costBasis, gain: money(value - costBasis) };
  });
}
function dayString(date: Date) { return date.toISOString().slice(0, 10); }
function suggestions(quotes: Quote[]) {
  return quotes.filter(q => !q.stale).map((q) => {
    const score = Math.max(0, Math.min(100, Math.round(50 + q.changePercent * 4)));
    return { symbol: q.symbol, title: score >= 60 ? "Positive daily momentum" : score <= 40 ? "Negative daily momentum" : "Mixed daily movement", reason: `Rule: ${q.changePercent >= 0 ? "+" : ""}${q.changePercent.toFixed(2)}% versus previous close; score is 50 + daily change × 4, clamped to 0–100. This describes one day and is not a forecast.`, score };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}
function createGeneratedLedger(initialCash: number, days: number, seed: number): State {
  const inception = dayString(new Date(Date.parse(`${todayString()}T00:00:00Z`) - days * 86400000));
  const trades: Trade[] = [];
  let cash = initialCash;
  const plan = [
    { symbol: "AAPL", day: Math.max(1, Math.floor(days * 0.12)), budget: initialCash * 0.2 },
    { symbol: "MSFT", day: Math.max(2, Math.floor(days * 0.28)), budget: initialCash * 0.18 },
    { symbol: "NVDA", day: Math.max(3, Math.floor(days * 0.42)), budget: initialCash * 0.2 },
    { symbol: "SPY", day: Math.max(4, Math.floor(days * 0.56)), budget: initialCash * 0.16 },
  ];
  for (const item of plan) {
    const date = dayString(new Date(Date.parse(`${inception}T00:00:00Z`) + item.day * 86400000));
    const price = syntheticClose(item.symbol, date, seed);
    const quantity = Math.floor((Math.min(item.budget, cash) / price) * 10_000) / 10_000;
    const value = money(quantity * price);
    if (quantity > 0 && value >= 0.01) {
      trades.push({ id: `generated-buy-${item.symbol.toLowerCase()}`, symbol: item.symbol, side: "buy", quantity, price, createdAt: `${date}T14:30:00.000Z` });
      cash = money(cash - value);
    }
  }
  const firstBuy = trades[0];
  if (firstBuy) {
    const sellDate = dayString(new Date(Date.parse(`${inception}T00:00:00Z`) + Math.min(days - 1, Math.floor(days * 0.78)) * 86400000));
    const price = syntheticClose(firstBuy.symbol, sellDate, seed);
    const quantity = Math.floor(firstBuy.quantity * 0.25 * 10_000) / 10_000;
    if (quantity > 0) trades.push({ id: "generated-sell-partial", symbol: firstBuy.symbol, side: "sell", quantity, price, createdAt: `${sellDate}T14:30:00.000Z` });
  }
  for (const trade of trades) {
    if (trade.side === "sell") cash = money(cash + trade.quantity * trade.price);
  }
  return { cash, trades, seed, days, inception };
}
async function historyFor(row: AccountRow, state: State, mode: Mode, days: number) {
  const output = [];
  const today = todayString();
  const start = Math.max(Date.parse(`${state.inception}T00:00:00Z`), Date.parse(`${today}T00:00:00Z`) - days * 86400000);
  const last = Date.parse(`${today}T00:00:00Z`);
  for (let stamp = start; stamp <= last; stamp += 86400000) {
    const date = dayString(new Date(stamp));
    let cash = row.initial_cash / 100;
    let positions = new Map<string, { qty: number; cost: number }>();
    for (const t of state.trades) if (easternTradeDate(t.createdAt) <= date) {
      const p = positions.get(t.symbol) ?? { qty: 0, cost: 0 };
      if (t.side === "buy") { p.qty += t.quantity; p.cost += t.quantity * t.price; cash = money(cash - money(t.quantity * t.price)); }
      else { const avg = p.qty ? p.cost / p.qty : 0; p.qty -= t.quantity; p.cost -= avg * t.quantity; cash = money(cash + money(t.quantity * t.price)); }
      positions.set(t.symbol, p);
    }
    let value = cash;
    for (const [symbol, p] of positions) if (p.qty > 0) value += money(p.qty * (mode === "synthetic" ? syntheticClose(symbol, date, state.seed) : (state.trades.filter(t => t.symbol === symbol && t.createdAt.slice(0,10) <= date).at(-1)?.price ?? 0)));
    output.push({ date, value: money(value), invested: row.initial_cash / 100 });
  }
  return output;
}
async function persistedLiveHistory(row: AccountRow, state: State) {
  const rows = await database().prepare("SELECT date,value,invested FROM paper_history WHERE account_id=? AND mode='live' AND date>=? AND date<=? ORDER BY date").bind(row.id, state.inception, todayString()).all<{ date: string; value: number; invested: number }>();
  return (rows.results ?? []).map(item => ({ date: item.date, value: item.value / 100, invested: item.invested / 100 }));
}
async function saveSnapshot(row: AccountRow, state: State, mode: Mode, quotes: Quote[], date = todayString()) {
  const qmap = new Map(quotes.map(q => [q.symbol, q]));
  const holdings = holdingsOf(state.trades, qmap);
  const total = money(state.cash + holdings.reduce((sum, holding) => sum + holding.value, 0));
  const invested = row.initial_cash / 100;
  const result = await database().prepare("INSERT OR REPLACE INTO paper_history(id,account_id,mode,date,value,invested) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM paper_accounts WHERE id=? AND mode=? AND version=?)")
    .bind(`${mode}:${row.id}:${date}`, row.id, mode, date, Math.round(total * 100), Math.round(invested * 100), row.id, mode, row.version).run();
  if (result.meta.changes !== 1) throw err("Account changed while recording its snapshot; retry the request", 409);
  return { date, value: total, invested };
}
export async function getState(params: URLSearchParams) {
  const mode = modeValue(params.get("mode") ?? "synthetic");
  await ensureSeedAccounts(mode);
  const accounts = await listAccounts(mode);
  const selected = params.get("accountId") ?? accounts[0]?.id;
  if (!selected) throw err("No accounts available", 503);
  const row = await account(selected, mode), state = parse(row);
  const allQuotes = await quotesFor(mode, UNIVERSE.map(x => x.symbol), state.seed);
  const qmap = new Map(allQuotes.map(q => [q.symbol, q]));
  const holdings = holdingsOf(state.trades, qmap);
  const marketValue = money(holdings.reduce((n, h) => n + h.value, 0));
  const totalValue = money(state.cash + marketValue);
  const initialInvestment = row.initial_cash / 100;
  const snapshot = await saveSnapshot(row, state, mode, allQuotes);
  const history = mode === "live"
    ? await persistedLiveHistory(row, state)
    : await historyFor(row, state, mode, Math.min(state.days || 365, 1825));
  if (mode === "live" && !history.some(item => item.date === snapshot.date)) history.push(snapshot);
  const candleSymbol = params.get("symbol") ?? "SPY";
  if (!UNIVERSE.some(s => s.symbol === candleSymbol)) throw err("Unsupported symbol");
  const historyDays = Math.min(state.days || 365, 1825);
  let candles: Array<{ date: string; close: number }> = [];
  let candleWarning = "";
  try {
    candles = mode === "live" ? await alpacaCandles(candleSymbol, historyDays) : Array.from({ length: historyDays + 1 }, (_, i) => {
      const date = dayString(new Date(Date.parse(`${todayString()}T00:00:00Z`) - (historyDays - i) * 86400000));
      return { date, close: syntheticClose(candleSymbol, date, state.seed) };
    });
  } catch (error) {
    candleWarning = error instanceof Error ? error.message : "Chart candles are unavailable.";
  }
  const market = { mode, configured: mode === "synthetic" || Boolean(env.ALPACA_API_KEY && env.ALPACA_API_SECRET), message: candleWarning || (mode === "live" && !env.ALPACA_API_KEY ? "Configure Alpaca API credentials to load live IEX prices." : mode === "live" && allQuotes.some(q => q.stale) ? "Some quotes are stale; the market may be closed." : mode === "live" ? "Live market data via Alpaca IEX. Paper trading only." : "Deterministic synthetic market data for educational paper trading."), asOf: allQuotes.reduce((a,q) => q.timestamp > a ? q.timestamp : a, "") };
  return { accounts: accounts.map(a => ({ id: a.id, name: a.name, initialCash: a.initial_cash / 100, mode: a.mode })), account: { id: row.id, name: row.name, initialCash: initialInvestment, cash: money(state.cash), mode }, quotes: allQuotes, holdings, trades: state.trades.slice().reverse().slice(0, 100), history, candles, suggestions: suggestions(allQuotes), summary: { initialInvestment, marketValue, cash: money(state.cash), totalValue, totalGain: money(totalValue - initialInvestment), totalGainPercent: initialInvestment ? money((totalValue / initialInvestment - 1) * 100) : 0 }, market };
}
export async function snapshotAllLiveAccounts() {
  if (!env.ALPACA_API_KEY || !env.ALPACA_API_SECRET) throw err("Daily live snapshots require ALPACA_API_KEY and ALPACA_API_SECRET", 503);
  await ensureSeedAccounts("live");
  const accounts = await listAccounts("live");
  const results: Array<{ accountId: string; status: "saved" | "error"; stale?: boolean; asOf?: string | null; error?: string }> = [];
  for (const row of accounts) {
    try {
      const state = parse(row);
      const symbols = [...new Set(state.trades.map(trade => trade.symbol))];
      const quotes = await Promise.all(symbols.map(symbol => alpacaQuote(symbol, true)));
      await saveSnapshot(row, state, "live", quotes);
      results.push({ accountId: row.id, status: "saved", stale: quotes.some(quote => quote.stale), asOf: quotes.map(quote => quote.timestamp).sort().at(-1) ?? null });
    } catch (error) {
      results.push({ accountId: row.id, status: "error", error: error instanceof Error ? error.message : "Snapshot failed" });
    }
  }
  return { ok: results.every(result => result.status === "saved"), date: todayString(), accounts: results };
}
export async function postAction(body: unknown) {
  if (!body || typeof body !== "object") throw err("JSON object body is required");
  const data = body as Record<string, unknown>;
  if (data.action === "create") {
    const name = typeof data.name === "string" ? data.name.trim().slice(0, 60) : "";
    if (!name) throw err("name is required");
    const mode = modeValue(typeof data.mode === "string" ? data.mode : "");
    const initialCash = money(finite(data.initialCash, "initialCash", 100, 100_000_000));
    const accountId = id(), timestamp = now();
    const state: State = { cash: initialCash, trades: [], seed: 2025, days: 365, inception: todayString() };
    await database().prepare("INSERT INTO paper_accounts(id,name,mode,initial_cash,version,state_json,created_at,updated_at) VALUES(?,?,?,?,0,?,?,?)").bind(accountId, name, mode, Math.round(initialCash * 100), JSON.stringify(state), timestamp, timestamp).run();
    return { ok: true, accountId };
  }
  const mode = modeValue(typeof data.mode === "string" ? data.mode : "");
  const accountId = typeof data.accountId === "string" ? data.accountId : "";
  if (data.action === "generate") {
    if (mode !== "synthetic") throw err("History generation is available only in synthetic mode", 400);
    if (data.confirmReset !== true) throw err("confirmReset must be true before replacing this account's trades and snapshots", 400);
    const days = Math.floor(finite(data.days, "days", 30, 1825));
    const seed = data.seed === undefined ? 2025 : Math.floor(finite(data.seed, "seed", 0, 2147483647));
    for (let attempt = 0; attempt < 4; attempt++) {
      const row = await account(accountId, mode);
      const s = createGeneratedLedger(row.initial_cash / 100, days, seed);
      if (await save(row, s)) {
        const history = await historyFor(row, s, mode, days);
        const db = database();
        await db.prepare("DELETE FROM paper_history WHERE account_id=? AND mode=?").bind(accountId, mode).run();
        for (let at = 0; at < history.length; at += 50) {
          const statements = history.slice(at, at + 50).map(day => db.prepare("INSERT OR REPLACE INTO paper_history(id,account_id,mode,date,value,invested) VALUES(?,?,?,?,?,?)").bind(`${mode}:${accountId}:${day.date}`, accountId, mode, day.date, Math.round(day.value * 100), Math.round(day.invested * 100)));
          await db.batch(statements);
        }
        return { ok: true, accountId };
      }
    }
    throw err("Account changed concurrently; retry the request", 409);
  }
  if (data.action === "snapshot") {
    const row = await account(accountId, mode), state = parse(row);
    const symbols = [...new Set(state.trades.map(trade => trade.symbol))];
    const quotes = await quotesFor(mode, symbols, state.seed);
    await saveSnapshot(row, state, mode, quotes);
    return { ok: true, accountId };
  }
  if (data.action !== "trade") throw err("action must be create, trade, generate, or snapshot");
  const symbol = typeof data.symbol === "string" ? data.symbol.toUpperCase() : "";
  if (!UNIVERSE.some(x => x.symbol === symbol)) throw err("symbol is not in the supported universe");
  const side = data.side === "buy" || data.side === "sell" ? data.side : null;
  if (!side) throw err("side must be buy or sell");
  const quantity = Math.round(finite(data.quantity, "quantity", 0.0001, 1_000_000) * 10000) / 10000;
  let requestId: string | undefined;
  if (data.requestId !== undefined) {
    if (typeof data.requestId !== "string" || data.requestId.length < 1 || data.requestId.length > 128 || !/^[\w.-]+$/.test(data.requestId)) throw err("requestId must be 1–128 letters, numbers, dots, underscores, or hyphens");
    requestId = data.requestId;
  }
  let liveQuote: Quote | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await account(accountId, mode), state = parse(row);
    if (requestId) {
      const existing = state.trades.find(trade => trade.requestId === requestId);
      if (existing) {
        if (existing.symbol !== symbol || existing.side !== side || existing.quantity !== quantity) throw err("requestId was already used for a different trade", 409);
        return { ok: true, accountId };
      }
    }
    if (mode === "live" && !liveQuote) {
      liveQuote = await alpacaQuote(symbol, true);
      if (liveQuote.stale) throw err("Live quote is stale; trading is paused until a fresh Alpaca IEX quote is available", 503);
    }
    const quote = liveQuote ?? (await quotesFor(mode, [symbol], state.seed))[0];
    const positions = holdingsOf(state.trades, new Map([[symbol, quote]]));
    const held = positions.find(h => h.symbol === symbol)?.quantity ?? 0;
    const amount = money(quantity * quote.price);
    if (amount < 0.01) throw err("Trade value must be at least $0.01");
    if (side === "buy" && amount > state.cash + 0.0001) throw err("Insufficient cash");
    if (side === "sell" && quantity > held + 0.00001) throw err("Insufficient shares to sell");
    state.cash = money(state.cash + (side === "buy" ? -amount : amount));
    state.trades.push({ id: id(), symbol, side, quantity, price: quote.price, createdAt: now(), ...(requestId ? { requestId } : {}) });
    if (await save(row, state)) return { ok: true, accountId };
  }
  throw err("Account changed concurrently; retry the trade", 409);
}
export function errorResponse(error: unknown) {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status: number }).status) : 500;
  return Response.json({ error: error instanceof Error ? error.message : "Unexpected server error" }, { status: status >= 400 && status <= 599 ? status : 500 });
}
