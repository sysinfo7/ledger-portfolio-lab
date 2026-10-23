import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import ts from "../node_modules/typescript/lib/typescript.js";

const baseFrozenTime = Date.parse("2026-10-20T01:00:00.000Z");
let frozenTime = baseFrozenTime;
let testClock = 0;
const NativeDate = Date;
globalThis.Date = class FrozenDate extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [frozenTime])); }
  static now() { return frozenTime; }
};

const env = { DB: null, ALPACA_API_KEY: undefined, ALPACA_API_SECRET: undefined };
globalThis.__TEST_ENV__ = env;
const sourcePath = new URL("../lib/paper-market.ts", import.meta.url);
const source = await readFile(sourcePath, "utf8");
const transformed = ts.transpileModule(
  source.replace(/^import\s+\{\s*env\s*\}\s+from\s+["']cloudflare:workers["'];\s*$/m, "const env = globalThis.__TEST_ENV__;"),
  { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } },
).outputText;
const tempDir = await mkdtemp(path.join(os.tmpdir(), "paper-market-tests-"));
const modulePath = path.join(tempDir, "paper-market.mjs");
await writeFile(modulePath, transformed, "utf8");
const market = await import(pathToFileURL(modulePath).href);

const schema = `
  CREATE TABLE paper_accounts (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, mode TEXT NOT NULL,
    initial_cash INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 0,
    state_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE paper_history (
    id TEXT PRIMARY KEY, account_id TEXT NOT NULL, mode TEXT NOT NULL,
    date TEXT NOT NULL, value INTEGER NOT NULL, invested INTEGER NOT NULL
  );
  CREATE TABLE paper_candles (
    id TEXT PRIMARY KEY, mode TEXT NOT NULL, symbol TEXT NOT NULL,
    date TEXT NOT NULL, close INTEGER NOT NULL
  );
`;

function makeD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(schema);
  return {
    prepare(sql) {
      let values = [];
      const prepared = {
        bind(...args) { values = args; return prepared; },
        async run() {
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
        async first() { return sqlite.prepare(sql).get(...values) ?? null; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...values) }; },
      };
      return prepared;
    },
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
    exec(sql, ...values) { return sqlite.prepare(sql).run(...values); },
    close() { sqlite.close(); },
  };
}

let db;
beforeEach(() => {
  db?.close();
  db = makeD1();
  env.DB = db;
  env.ALPACA_API_KEY = undefined;
  env.ALPACA_API_SECRET = undefined;
  frozenTime = baseFrozenTime + testClock++ * 61_000;
  globalThis.fetch = async () => { throw new Error("Unexpected network request in test"); };
});
after(async () => {
  db?.close();
  globalThis.Date = NativeDate;
  delete globalThis.__TEST_ENV__;
  await rm(tempDir, { recursive: true, force: true });
});

async function createAccount(name = "Test", initialCash = 10_000, mode = "synthetic") {
  const result = await market.postAction({ action: "create", name, initialCash, mode });
  return result.accountId;
}
async function state(accountId, mode = "synthetic") {
  return market.getState(new URLSearchParams({ mode, accountId }));
}
async function trade(accountId, side, quantity, mode = "synthetic", symbol = "AAPL") {
  return market.postAction({ action: "trade", accountId, mode, symbol, side, quantity });
}
function mockAlpaca({ quotePrice = 100, quoteTimestamp = new Date().toISOString(), bars = [], barStatus = 200 } = {}) {
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.includes("/snapshot?")) return Response.json({ latestTrade: { p: quotePrice, t: quoteTimestamp }, prevDailyBar: { c: quotePrice - 1 } });
    if (url.includes("/bars?")) return new Response(JSON.stringify({ bars }), { status: barStatus, headers: { "content-type": "application/json" } });
    throw new Error(`Unexpected mocked request: ${url}`);
  };
  env.ALPACA_API_KEY = "test-key";
  env.ALPACA_API_SECRET = "test-secret";
}

test("buy keeps cash, holdings, market value, and P&L in agreement", async () => {
  const accountId = await createAccount();
  const before = await state(accountId);
  const price = before.quotes.find(q => q.symbol === "AAPL").price;
  await trade(accountId, "buy", 1.2345);
  const after = await state(accountId);
  assert.equal(after.account.cash, Math.round((10_000 - 1.2345 * price) * 100) / 100);
  assert.equal(after.holdings[0].quantity, 1.2345);
  assert.equal(after.summary.marketValue, after.holdings[0].value);
  assert.equal(after.summary.totalValue, Math.round((after.account.cash + after.summary.marketValue) * 100) / 100);
  assert.equal(after.summary.totalGain, Math.round((after.summary.totalValue - 10_000) * 100) / 100);
});

test("sell realizes cash and removes only the requested fractional shares", async () => {
  const accountId = await createAccount();
  await trade(accountId, "buy", 1.2345);
  await trade(accountId, "sell", 0.2345);
  const after = await state(accountId);
  assert.equal(after.holdings.find(h => h.symbol === "AAPL").quantity, 1);
  assert.equal(after.trades.filter(t => t.symbol === "AAPL").length, 2);
  assert.ok(after.account.cash > 9_000);
});

test("buy rejects overspending without changing the account", async () => {
  const accountId = await createAccount("Small", 100);
  const before = await state(accountId);
  await assert.rejects(trade(accountId, "buy", 1_000), /Insufficient cash/);
  const after = await state(accountId);
  assert.equal(after.account.cash, before.account.cash);
  assert.equal(after.trades.length, 0);
});

test("sell rejects more shares than held without changing the account", async () => {
  const accountId = await createAccount();
  await trade(accountId, "buy", 0.5);
  await assert.rejects(trade(accountId, "sell", 0.5001), /Insufficient shares/);
  const after = await state(accountId);
  assert.equal(after.holdings[0].quantity, 0.5);
  assert.equal(after.trades.length, 1);
});

test("trade quantities preserve four-decimal fractional shares", async () => {
  const accountId = await createAccount();
  await trade(accountId, "buy", 0.123456);
  const after = await state(accountId);
  assert.equal(after.holdings[0].quantity, 0.1235);
});

test("concurrent buys use compare-and-swap retries without losing a trade", async () => {
  const accountId = await createAccount("Concurrent", 100_000);
  const results = await Promise.all([
    trade(accountId, "buy", 2),
    trade(accountId, "buy", 3),
  ]);
  assert.equal(results.length, 2);
  const after = await state(accountId);
  assert.equal(after.trades.length, 2);
  assert.equal(after.holdings[0].quantity, 5);
});

test("synthetic history is deterministic and ends on the frozen current date", async () => {
  const accountId = await createAccount();
  await assert.rejects(
    market.postAction({ action: "generate", accountId, mode: "synthetic", days: 30, seed: 818 }),
    /confirmReset/i,
  );
  await market.postAction({ action: "generate", accountId, mode: "synthetic", days: 30, seed: 818, confirmReset: true });
  const first = await state(accountId);
  const second = await state(accountId);
  assert.deepEqual(first.history, second.history);
  assert.deepEqual(first.candles, second.candles);
  assert.ok(first.history.every(item => item.date <= "2026-10-19"));
  assert.ok(first.candles.every(item => item.date <= "2026-10-19"));
  assert.equal(first.history.at(-1).date, "2026-10-19");
  assert.equal(market.syntheticClose("AAPL", "2026-10-19", 818), market.syntheticClose("AAPL", "2026-10-19", 818));
});

test("New York midnight rollover keeps the same-day trade in the final history and summary", async () => {
  frozenTime = baseFrozenTime;
  assert.equal(new Date().toISOString(), "2026-10-20T01:00:00.000Z");
  const accountId = await createAccount();
  await trade(accountId, "buy", 1);
  const current = await state(accountId);
  assert.equal(current.history.at(-1).date, "2026-10-19");
  assert.equal(current.history.at(-1).value, current.summary.totalValue);
  assert.equal(current.trades.length, 1);
  assert.equal(current.holdings[0].quantity, 1);
  assert.ok(current.account.cash < current.summary.initialInvestment);
});

test("repeating a trade requestId returns success without applying the trade twice", async () => {
  const accountId = await createAccount();
  const request = { action: "trade", accountId, mode: "synthetic", symbol: "AAPL", side: "buy", quantity: 1, requestId: "repeat-one" };
  const first = await market.postAction(request);
  const second = await market.postAction(request);
  assert.equal(second.ok, true);
  assert.equal(second.accountId, first.accountId);
  const current = await state(accountId);
  assert.equal(current.trades.length, 1);
  assert.equal(current.holdings[0].quantity, 1);
});

test("concurrent requests with the same requestId execute a trade once", async () => {
  const accountId = await createAccount();
  const request = { action: "trade", accountId, mode: "synthetic", symbol: "AAPL", side: "buy", quantity: 1, requestId: "parallel-one" };
  const results = await Promise.all([market.postAction(request), market.postAction(request)]);
  assert.ok(results.every(result => result.ok));
  const current = await state(accountId);
  assert.equal(current.trades.length, 1);
  assert.equal(current.holdings[0].quantity, 1);
});

test("reusing a requestId with a different trade payload is rejected", async () => {
  const accountId = await createAccount();
  await market.postAction({ action: "trade", accountId, mode: "synthetic", symbol: "AAPL", side: "buy", quantity: 1, requestId: "payload-one" });
  await assert.rejects(
    market.postAction({ action: "trade", accountId, mode: "synthetic", symbol: "MSFT", side: "buy", quantity: 1, requestId: "payload-one" }),
    /request.?id.*(different|reuse|payload)|different.*request.?id/i,
  );
  const current = await state(accountId);
  assert.equal(current.trades.length, 1);
  assert.equal(current.trades[0].symbol, "AAPL");
});

test("live history retains stored rows older than 365 days", async () => {
  mockAlpaca();
  const accountId = await createAccount("Long history", 10_000, "live");
  const older = "2025-10-18";
  db.exec("UPDATE paper_accounts SET state_json=? WHERE id=?", JSON.stringify({ cash: 10_000, trades: [], seed: 2025, days: 365, inception: older }), accountId);
  db.exec("INSERT INTO paper_history(id,account_id,mode,date,value,invested) VALUES(?,?,?,?,?,?)", `live:${accountId}:${older}`, accountId, "live", older, 1_000_000, 1_000_000);
  mockAlpaca({ bars: [{ t: `${older}T00:00:00Z`, c: 100 }] });
  const current = await state(accountId, "live");
  assert.ok(current.history.some(item => item.date === older));
});

test("live candle failure preserves quote and portfolio data and returns a warning", async () => {
  mockAlpaca({ barStatus: 503 });
  const accountId = await createAccount("Live warning", 10_000, "live");
  const current = await state(accountId, "live");
  assert.equal(current.quotes.length, 10);
  assert.equal(current.summary.totalValue, 10_000);
  assert.deepEqual(current.candles, []);
  assert.match(current.market.message, /candle|bar|alpaca.*503/i);
});

test("cached live quote is marked stale after its trade timestamp ages", async () => {
  const stamp = new Date().toISOString();
  mockAlpaca({ quoteTimestamp: stamp });
  const accountId = await createAccount("Live stale", 10_000, "live");
  const fresh = await state(accountId, "live");
  assert.equal(fresh.quotes.find(quote => quote.symbol === "AAPL").stale, false);
  frozenTime += 121_000;
  globalThis.fetch = async () => { throw new Error("temporary provider failure"); };
  const aged = await state(accountId, "live");
  assert.equal(aged.quotes.find(quote => quote.symbol === "AAPL").stale, true);
});

test("accounts are isolated from one another", async () => {
  const firstId = await createAccount("First");
  const secondId = await createAccount("Second");
  await trade(firstId, "buy", 1);
  const first = await state(firstId);
  const second = await state(secondId);
  assert.equal(first.holdings.length, 1);
  assert.equal(second.holdings.length, 0);
  assert.equal(second.account.cash, 10_000);
});

test("live mode fails closed when credentials are missing", async () => {
  const accountId = await createAccount("Live", 10_000, "live");
  await assert.rejects(state(accountId, "live"), /Live quotes are unavailable/);
  await assert.rejects(trade(accountId, "buy", 1, "live"), /Live quotes are unavailable/);
});

test("generate rejects live mode", async () => {
  const accountId = await createAccount("Live", 10_000, "live");
  await assert.rejects(
    market.postAction({ action: "generate", accountId, mode: "live", days: 30, seed: 42 }),
    /generate.*synthetic|synthetic.*generate|only.*synthetic/i,
  );
});

test("invalid modes, symbols, sides, quantities, and actions are rejected", async () => {
  const accountId = await createAccount();
  await assert.rejects(state(accountId, "unknown"), /mode must be synthetic or live/);
  await assert.rejects(trade(accountId, "buy", 1, "synthetic", "NOPE"), /supported universe/);
  await assert.rejects(market.postAction({ action: "trade", accountId, mode: "synthetic", symbol: "AAPL", side: "hold", quantity: 1 }), /side must be buy or sell/);
  await assert.rejects(trade(accountId, "buy", 0), /quantity must be between/);
  await assert.rejects(market.postAction({ action: "wat", mode: "synthetic", accountId }), /action must be/);
});
