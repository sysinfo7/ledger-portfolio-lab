// Synthetic-only portfolio ledger for the public demo. No network or provider data.
export const UNIVERSE = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corporation", sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA Corporation", sector: "Technology" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", sector: "Consumer Discretionary" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Communication Services" },
  { symbol: "META", name: "Meta Platforms, Inc.", sector: "Communication Services" },
  { symbol: "TSLA", name: "Tesla, Inc.", sector: "Consumer Discretionary" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", sector: "ETF" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", sector: "ETF" },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", sector: "Financials" },
];

const END = "2026-10-19";
const MIN_DAYS = 30;
const MAX_DAYS = 1825;
const MAX_TRADES = 10000;
const BASE_DATE = "2020-01-01";
const BASE_PRICES = { AAPL: 75, MSFT: 160, NVDA: 55, AMZN: 95, GOOGL: 105, META: 140, TSLA: 90, SPY: 330, QQQ: 220, JPM: 110 };
const BY_SYMBOL = new Map(UNIVERSE.map((item) => [item.symbol, item]));
const DAY_MS = 86400000;
const priceCache = new Map();

function fail(message) { throw new Error(message); }
function round(value, places = 2) { const n = 10 ** places; return Math.round((value + Number.EPSILON) * n) / n; }
function cents(value) { return round(value, 2); }
function validDate(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
function shiftDate(date, amount) { return new Date(Date.parse(`${date}T00:00:00Z`) + amount * DAY_MS).toISOString().slice(0, 10); }
function dayIndex(date) { return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS); }
function hash32(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return h >>> 0;
}
function random01(seed, key) { return hash32(`${seed}|${key}`) / 4294967296; }
function knownSymbol(symbol) { if (!BY_SYMBOL.has(symbol)) fail(`Unknown symbol: ${String(symbol)}`); }
function makeId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `demo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function validateDays(days) {
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) fail(`days must be an integer from ${MIN_DAYS} to ${MAX_DAYS}`);
}
function priceSeries(symbol, fromDate, toDate, seed) {
  knownSymbol(symbol);
  if (!validDate(fromDate) || !validDate(toDate) || fromDate > toDate) fail("Price dates must be valid and ordered YYYY-MM-DD dates");
  const start = dayIndex(fromDate), finish = dayIndex(toDate);
  if (finish - start > 3650) fail("Price range may not exceed 3650 days");
  const key = `${symbol}|${seed}|${fromDate}|${toDate}`;
  const cached = priceCache.get(key);
  if (cached) return cached;
  const prices = new Array(finish - start + 1);
  let price = BASE_PRICES[symbol];
  const baseIndex = dayIndex(BASE_DATE);
  for (let day = baseIndex; day <= finish; day++) {
    if (day >= start) prices[day - start] = cents(price);
    if (day < finish) {
      const n1 = random01(seed, `${symbol}|${day}|a`);
      const n2 = random01(seed, `${symbol}|${day}|b`);
      const noise = (n1 + n2 - 1) * (symbol === "TSLA" || symbol === "NVDA" ? 0.052 : 0.032);
      const drift = symbol === "SPY" || symbol === "QQQ" ? 0.00017 : 0.00012;
      price = Math.max(1, price * (1 + drift + noise));
    }
  }
  priceCache.set(key, prices);
  if (priceCache.size > 500) priceCache.delete(priceCache.keys().next().value);
  return prices;
}
export function priceAt(symbol, date, seed = 2026) {
  if (!validDate(date) || date < BASE_DATE) fail(`date must be from ${BASE_DATE} onward`);
  return priceSeries(symbol, BASE_DATE, date, seed).at(-1);
}

function replay(portfolio, throughDate = portfolio.scenarioDate) {
  const holdings = Object.create(null);
  let cash = portfolio.initialCash;
  const ordered = [...portfolio.trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const trade of ordered) {
    if (trade.date > throughDate) continue;
    const amount = trade.quantity * trade.price;
    if (trade.side === "buy") {
      cash -= amount;
      holdings[trade.symbol] = (holdings[trade.symbol] || 0) + trade.quantity;
    } else {
      cash += amount;
      holdings[trade.symbol] = (holdings[trade.symbol] || 0) - trade.quantity;
      if (Math.abs(holdings[trade.symbol]) < 0.00000001) holdings[trade.symbol] = 0;
    }
  }
  return { cash: cents(cash), holdings };
}
function newTrade(symbol, side, quantity, price, date, requestId) {
  const trade = { id: makeId(), symbol, side, quantity: round(quantity, 4), price: cents(price), date };
  if (requestId !== undefined) trade.requestId = requestId;
  return trade;
}
function createTradeSet(seed, initialCash, startDate, days) {
  const trades = [];
  let cash = initialCash;
  const holdings = Object.create(null);
  const picks = ["AAPL", "MSFT", "NVDA"];
  for (let i = 0; i < picks.length; i++) {
    const symbol = picks[i], date = shiftDate(startDate, Math.floor((i + 1) * days / 5));
    const price = priceAt(symbol, date, seed);
    const target = initialCash * [0.17, 0.19, 0.14][i];
    const quantity = Math.floor((target / price) * 10000) / 10000;
    const trade = newTrade(symbol, "buy", quantity, price, date);
    cash = cents(cash - quantity * price); holdings[symbol] = quantity; trades.push(trade);
  }
  const sellDate = shiftDate(startDate, Math.floor(days * 0.78));
  const soldQty = round(holdings.AAPL * 0.2, 4);
  trades.push(newTrade("AAPL", "sell", soldQty, priceAt("AAPL", sellDate, seed), sellDate));
  return trades.sort((a, b) => a.date.localeCompare(b.date));
}

export function createPortfolio(name, initialCash = 100000, seed = 2026, days = 365) {
  validateDays(days);
  if (typeof name !== "string" || !name.trim() || name.trim().length > 80) fail("name must contain 1 to 80 characters");
  if (!Number.isFinite(initialCash) || initialCash < 100 || initialCash > 1000000000) fail("initialCash must be between 100 and 1,000,000,000");
  if (!Number.isSafeInteger(seed)) fail("seed must be a safe integer");
  const startDate = shiftDate(END, -days);
  const portfolio = { id: makeId(), name: name.trim(), initialCash: cents(initialCash), cash: cents(initialCash), seed, startDate, scenarioDate: END, trades: createTradeSet(seed, cents(initialCash), startDate, days) };
  portfolio.cash = replay(portfolio).cash;
  return portfolio;
}

export function validatePortfolio(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { id, name, initialCash, cash, seed, startDate, scenarioDate, trades } = value;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim() || name.length > 80) return false;
  if (!Number.isFinite(initialCash) || initialCash < 100 || initialCash > 1000000000 || !Number.isFinite(cash) || !Number.isSafeInteger(seed)) return false;
  if (!validDate(startDate) || !validDate(scenarioDate) || startDate > scenarioDate || dayIndex(scenarioDate) - dayIndex(startDate) > MAX_DAYS || startDate < BASE_DATE) return false;
  if (!Array.isArray(trades) || trades.length > MAX_TRADES) return false;
  const ids = new Set(), requests = new Map();
  for (const t of trades) {
    if (!t || typeof t !== "object" || !BY_SYMBOL.has(t.symbol) || !["buy", "sell"].includes(t.side) || !Number.isFinite(t.quantity) || t.quantity <= 0 || round(t.quantity, 4) !== t.quantity || t.quantity * (t.price || 0) < 0.01 || !Number.isFinite(t.price) || t.price <= 0 || !validDate(t.date) || t.date < startDate || t.date > scenarioDate || typeof t.id !== "string" || !t.id || ids.has(t.id)) return false;
    ids.add(t.id);
    if (t.requestId !== undefined) {
      if (typeof t.requestId !== "string" || !t.requestId || requests.has(t.requestId)) return false;
      requests.set(t.requestId, `${t.symbol}|${t.side}|${t.quantity}`);
    }
  }
  const state = replay(value);
  if (state.cash < -0.001 || Math.abs(state.cash - cents(cash)) > 0.01) return false;
  return Object.values(state.holdings).every((quantity) => quantity >= -0.00000001);
}

export function trade(portfolio, order) {
  if (!validatePortfolio(portfolio)) fail("Invalid portfolio state");
  if (!order || typeof order !== "object") fail("Order must be an object");
  const { symbol, side, quantity, requestId } = order;
  knownSymbol(symbol);
  if (side !== "buy" && side !== "sell") fail("side must be buy or sell");
  if (!Number.isFinite(quantity) || quantity <= 0 || round(quantity, 4) !== quantity) fail("quantity must be finite, positive, and use at most four decimal places");
  if (requestId !== undefined && (typeof requestId !== "string" || !requestId || requestId.length > 160)) fail("requestId must be a non-empty string up to 160 characters");
  if (requestId !== undefined) {
    const prior = portfolio.trades.find((item) => item.requestId === requestId);
    if (prior) {
      if (`${prior.symbol}|${prior.side}|${prior.quantity}` === `${symbol}|${side}|${quantity}`) return portfolio;
      fail("requestId was already used for a different order");
    }
  }
  const price = priceAt(symbol, portfolio.scenarioDate, portfolio.seed);
  const gross = quantity * price;
  if (gross < 0.01) fail("Order value must be at least $0.01");
  const state = replay(portfolio);
  if (side === "buy" && gross > state.cash + 0.00001) fail("Insufficient cash for this order");
  if (side === "sell" && quantity > (state.holdings[symbol] || 0) + 0.00000001) fail("Cannot sell more shares than are held");
  if (portfolio.trades.length >= MAX_TRADES) fail("Portfolio trade limit reached");
  const updated = { ...portfolio, trades: [...portfolio.trades, newTrade(symbol, side, quantity, price, portfolio.scenarioDate, requestId)] };
  updated.cash = replay(updated).cash;
  return updated;
}

export function generateHistory(portfolio, days, seed = portfolio?.seed) {
  if (!portfolio || typeof portfolio !== "object" || typeof portfolio.id !== "string" || typeof portfolio.name !== "string" || !Number.isFinite(portfolio.initialCash)) fail("A portfolio with id, name, and initialCash is required");
  validateDays(days);
  if (!Number.isSafeInteger(seed)) fail("seed must be a safe integer");
  const startDate = shiftDate(END, -days);
  const generated = { ...portfolio, initialCash: cents(portfolio.initialCash), cash: cents(portfolio.initialCash), seed, startDate, scenarioDate: END, trades: [] };
  const rng = (() => { let n = hash32(String(seed)); return () => { n = (n + 0x6d2b79f5) >>> 0; let t = n; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const symbolList = UNIVERSE.map((x) => x.symbol);
  const count = Math.min(36, Math.max(10, Math.floor(days / 45)));
  // Precompute each ticker's prices once for the full scenario window.
  const allPrices = new Map(symbolList.map((symbol) => [symbol, priceSeries(symbol, startDate, END, seed)]));
  let cash = generated.initialCash;
  const holdings = Object.create(null);
  for (let i = 0; i < count; i++) {
    const date = shiftDate(startDate, Math.floor((i + 1) * (days - 2) / (count + 1)));
    let candidates = symbolList.filter((s) => (holdings[s] || 0) > 0);
    const sell = candidates.length > 0 && rng() < 0.32;
    const symbol = sell ? candidates[Math.floor(rng() * candidates.length)] : symbolList[Math.floor(rng() * symbolList.length)];
    const price = allPrices.get(symbol)[dayIndex(date) - dayIndex(startDate)];
    let quantity;
    if (sell) quantity = round(holdings[symbol] * (0.15 + rng() * 0.45), 4);
    else quantity = Math.floor((Math.min(cash * (0.08 + rng() * 0.12), generated.initialCash * 0.16) / price) * 10000) / 10000;
    if (!quantity || quantity * price < 0.01 || (!sell && quantity * price > cash)) continue;
    const item = newTrade(symbol, sell ? "sell" : "buy", quantity, price, date);
    generated.trades.push(item);
    if (sell) { cash += quantity * price; holdings[symbol] -= quantity; }
    else { cash -= quantity * price; holdings[symbol] = (holdings[symbol] || 0) + quantity; }
  }
  generated.trades.sort((a, b) => a.date.localeCompare(b.date));
  generated.cash = replay(generated).cash;
  return generated;
}

export function advanceDay(portfolio) {
  if (!validatePortfolio(portfolio)) fail("Invalid portfolio state");
  if (dayIndex(portfolio.scenarioDate) - dayIndex(portfolio.startDate) >= MAX_DAYS) fail("Regenerate history before advancing beyond the 1825 day limit");
  const nextDate = shiftDate(portfolio.scenarioDate, 1);
  if (nextDate > "2100-12-31") fail("Scenario date limit reached");
  return { ...portfolio, scenarioDate: nextDate };
}

function weightedCost(trades) {
  const book = Object.create(null);
  for (const t of [...trades].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    const item = book[t.symbol] || (book[t.symbol] = { quantity: 0, cost: 0 });
    if (t.side === "buy") { item.quantity += t.quantity; item.cost += t.quantity * t.price; }
    else if (item.quantity > 0) { const avg = item.cost / item.quantity; item.quantity -= t.quantity; item.cost -= avg * t.quantity; }
  }
  return book;
}

export function getView(portfolio, symbol = "AAPL") {
  if (!validatePortfolio(portfolio)) fail("Invalid portfolio state");
  knownSymbol(symbol);
  const days = dayIndex(portfolio.scenarioDate) - dayIndex(portfolio.startDate) + 1;
  if (days > MAX_DAYS + 1) fail("Portfolio history exceeds the 1826 point limit");
  const priceMap = new Map(UNIVERSE.map((item) => [item.symbol, priceSeries(item.symbol, portfolio.startDate, portfolio.scenarioDate, portfolio.seed)]));
  const byDate = new Map();
  for (const t of portfolio.trades) { const list = byDate.get(t.date) || []; list.push(t); byDate.set(t.date, list); }
  let cash = portfolio.initialCash;
  const holdings = Object.create(null);
  const history = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDate(portfolio.startDate, i);
    for (const t of byDate.get(date) || []) {
      const amount = t.quantity * t.price;
      if (t.side === "buy") { cash -= amount; holdings[t.symbol] = (holdings[t.symbol] || 0) + t.quantity; }
      else { cash += amount; holdings[t.symbol] = (holdings[t.symbol] || 0) - t.quantity; }
    }
    let mv = 0;
    for (const [s, q] of Object.entries(holdings)) mv += cents(q * priceMap.get(s)[i]);
    history.push({ date, value: cents(cents(cash) + mv), invested: cents(portfolio.initialCash) });
  }
  const state = replay(portfolio), costBook = weightedCost(portfolio.trades);
  const rows = Object.entries(state.holdings).filter(([, q]) => q > 0.00000001).map(([s, quantity]) => {
    const price = priceMap.get(s).at(-1), averageCost = costBook[s].quantity ? costBook[s].cost / costBook[s].quantity : 0;
    const costBasis = cents(averageCost * quantity), value = cents(price * quantity);
    return { symbol: s, quantity: round(quantity, 4), averageCost: cents(averageCost), costBasis, price, value, gain: cents(value - costBasis) };
  });
  const marketValue = cents(rows.reduce((sum, row) => sum + row.value, 0));
  const totalValue = history.at(-1).value;
  const quotes = UNIVERSE.map(({ symbol: s, name }) => {
    const series = priceMap.get(s), price = series.at(-1), previousClose = series.length > 1 ? series.at(-2) : price;
    return { symbol: s, name, price, previousClose, changePercent: previousClose ? round((price / previousClose - 1) * 100, 2) : 0 };
  });
  const selected = priceMap.get(symbol);
  const candles = selected.map((close, i) => ({ date: shiftDate(portfolio.startDate, i), close }));
  const suggestions = quotes.map((q) => {
    const series = priceMap.get(q.symbol), prior = series[Math.max(0, series.length - 21)];
    const score = round((q.price / prior - 1) * 100, 2);
    return { symbol: q.symbol, score, title: score >= 0 ? "Positive demo momentum" : "Negative demo momentum", reason: `Synthetic ${Math.min(20, series.length - 1)}-day price change: ${score >= 0 ? "+" : ""}${score}%. This is a simple historical rule, not a forecast.` };
  }).sort((a, b) => b.score - a.score);
  return {
    quotes,
    holdings: rows,
    history,
    candles,
    suggestions,
    summary: { initialInvestment: cents(portfolio.initialCash), cash: state.cash, marketValue, totalValue, totalGain: cents(totalValue - portfolio.initialCash), totalGainPercent: portfolio.initialCash ? round((totalValue / portfolio.initialCash - 1) * 100, 2) : 0 },
    trades: [...portfolio.trades].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
  };
}
