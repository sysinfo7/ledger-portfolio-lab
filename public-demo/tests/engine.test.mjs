import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceDay,
  createPortfolio,
  generateHistory,
  getView,
  priceAt,
  trade,
  validatePortfolio,
} from "../dist/engine.js";

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

test("prices and long generated histories are deterministic and bounded", () => {
  assert.equal(priceAt("AAPL", "2026-10-19", 17), priceAt("AAPL", "2026-10-19", 17));
  assert.notEqual(priceAt("AAPL", "2026-10-19", 17), priceAt("AAPL", "2026-10-19", 18));
  assert.throws(() => priceAt("NOPE", "2026-10-19"));

  const source = createPortfolio("Long account", 250000, 42, 30);
  const before = structuredClone(source);
  const first = generateHistory(source, 1825, 42);
  const second = generateHistory(source, 1825, 42);
  const view = getView(first, "MSFT");
  assert.deepEqual(source, before, "history generation must not mutate its input");
  assert.equal(view.history.length, 1826);
  assert.equal(view.candles.length, 1826);
  assert.deepEqual(view.history, getView(second, "MSFT").history);
  assert.deepEqual(view.candles, getView(second, "MSFT").candles);
  assert.equal(view.history[0].date, first.startDate);
  assert.equal(view.history.at(-1).date, first.scenarioDate);
  assert.equal(view.candles.at(-1).close, priceAt("MSFT", first.scenarioDate, first.seed));
  assert.equal(view.summary.cash, first.cash);
  assert.equal(view.summary.totalValue, view.history.at(-1).value);
  assert.equal(view.summary.totalValue, round2(view.summary.cash + view.summary.marketValue),
    "summary total must equal cash plus displayed market value to the cent");
  assert.ok(validatePortfolio(first));
});

test("buy and sell update cents, enforce cash and shares, and are idempotent", () => {
  const original = createPortfolio("Trade account", 100000, 2026, 365);
  const originalCopy = structuredClone(original);
  const held = original.trades.find((item) => item.side === "buy" && item.symbol === "AAPL");
  assert.ok(held);

  const requestId = "test-buy-1";
  const bought = trade(original, { symbol: "AAPL", side: "buy", quantity: 1.25, requestId });
  assert.notEqual(bought, original);
  assert.deepEqual(original, originalCopy, "trade must leave the source account unchanged");
  assert.equal(bought.cash, round2(bought.cash));
  assert.equal(bought.trades.filter((item) => item.requestId === requestId).length, 1);
  assert.equal(trade(bought, { symbol: "AAPL", side: "buy", quantity: 1.25, requestId }), bought);
  assert.throws(() => trade(bought, { symbol: "MSFT", side: "buy", quantity: 1.25, requestId }));

  const sold = trade(bought, { symbol: "AAPL", side: "sell", quantity: 0.5, requestId: "test-sell-1" });
  assert.equal(sold.cash, round2(sold.cash));
  assert.ok(validatePortfolio(sold));
  assert.throws(() => trade(sold, { symbol: "AAPL", side: "sell", quantity: 1e9 }));

  const poor = createPortfolio("Small account", 100, 2026, 30);
  assert.throws(() => trade(poor, { symbol: "NVDA", side: "buy", quantity: 100000 }));
  assert.throws(() => trade(original, { symbol: "AAPL", side: "buy", quantity: 1e9 }));
});

test("advancing a scenario preserves the ledger and moves synthetic valuations", () => {
  const portfolio = createPortfolio("Scenario account", 100000, 91, 365);
  const before = getView(portfolio, "AAPL");
  const next = advanceDay(portfolio);
  const after = getView(next, "AAPL");
  assert.deepEqual(portfolio.scenarioDate, "2026-10-19");
  assert.equal(next.scenarioDate, "2026-10-20");
  assert.deepEqual(next.trades, portfolio.trades);
  assert.equal(next.cash, portfolio.cash);
  assert.equal(after.history.length, before.history.length + 1);
  assert.equal(after.history.at(-1).date, next.scenarioDate);
  assert.equal(after.candles.at(-1).close, priceAt("AAPL", next.scenarioDate, next.seed));
  assert.notEqual(after.summary.totalValue, before.summary.totalValue);
  assert.equal(before.history.at(-1).date, portfolio.scenarioDate);
});

test("accounts remain isolated and invalid restored ledgers are rejected", () => {
  const left = createPortfolio("Left", 100000, 2, 365);
  const right = createPortfolio("Right", 100000, 2, 365);
  const leftChanged = trade(left, { symbol: "AAPL", side: "buy", quantity: 2 });
  assert.equal(right.trades.length, createPortfolio("Right", 100000, 2, 365).trades.length);
  assert.notEqual(leftChanged.trades.length, right.trades.length);
  assert.ok(validatePortfolio(right));

  const corruptions = [
    { ...left, cash: left.cash + 100 },
    { ...left, initialCash: Number.NaN },
    { ...left, scenarioDate: "not-a-date" },
    { ...left, trades: [...left.trades, { ...left.trades[0] }] },
    { ...left, trades: left.trades.map((item, index) => index ? item : { ...item, quantity: -1 }) },
    { ...left, trades: left.trades.map((item, index) => index ? item : { ...item, symbol: "FAKE" }) },
    { ...left, trades: left.trades.map((item, index) => index ? item : { ...item, date: "2027-01-01" }) },
  ];
  for (const value of corruptions) assert.equal(validatePortfolio(value), false);
  assert.equal(validatePortfolio(null), false);
  assert.equal(validatePortfolio([]), false);
  assert.throws(() => createPortfolio("", 100000, 1, 30));
  assert.throws(() => createPortfolio("Bad cash", 99, 1, 30));
  assert.throws(() => createPortfolio("Bad duration", 100000, 1, 1826));
  assert.throws(() => generateHistory(left, 1826, 2));
});
