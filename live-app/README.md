# Ledger Paper Market

A portfolio engineering demo: named paper accounts, server-side Alpaca IEX data,
simulated orders, holdings, returns, charts, durable daily valuations, and seeded
long-term test scenarios. No real brokerage orders are sent.

## Run locally

Use Node 24. Install with `npm ci`, generate/build with `npm run build`, then run
`node scripts/docker-start.mjs` (the runner works locally too). Open port 8787.
The runner applies each SQL migration once and retains D1 data in
`.wrangler/state`. For development with hot reload use `npm run dev` after
applying local migrations. The deployment uses the Sites Vinext/Cloudflare
Worker runtime and a managed D1 database.

Alternatively use `docker compose up --build`. Its named volume keeps portfolio
data across container restarts. `docker compose down` retains that volume;
removing the volume deletes the local database.

## Connect live data

Create an Alpaca account and API key. Copy `.dev.vars.example` to `.dev.vars`
and set `ALPACA_API_KEY` and `ALPACA_API_SECRET`. For Docker, enable the optional
read-only file mount in `compose.yaml`. Hosted deployments use secret runtime
variables configured through Sites. Never put keys in browser code or Git.

The free feed covers IEX, not the entire US market. Quotes show provider trade
timestamps and freshness; stale prices cannot fill orders. Polling is near-live,
not a tick-by-tick consolidated feed. Chart bars are historical daily bars.
Live mode never substitutes synthetic quotes. Provider failures are visible.
The supported watchlist is AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, SPY, QQQ,
and JPM. Expansion requires a provider symbol directory and corresponding UI.

## Accounts, persistence, and performance

Accounts are selectable shared demo personas, not private authenticated users.
There are no account passwords. The hosted Site starts owner-private at the
platform boundary; changing its audience would expose its shared portfolios.
Live and synthetic accounts have separate ledgers and histories.

Portfolio value = available cash + current holding values. Total return compares
that value with starting capital. Position return compares market value with
remaining average-cost basis. Virtual fills use displayed market prices and
exclude commissions, slippage, spread, dividends, and corporate actions.
This is a learning simulator rather than a brokerage accounting system.

Daily valuations are saved during use and through the snapshot endpoint. The
hosted Site has an enabled weekday updater at 4:10 PM America/New_York that calls
`POST /api/daily`; its write and readback path has been verified. Local copies
need their own scheduler if they should record values while the browser is closed.
Actual live portfolio history begins when observations are saved; it is never
fabricated by backfilling with present prices. Back up exported history and the
database for independent long-term retention.

Synthetic history uses a deterministic seeded price path and generated trades.
The generator replaces only the selected synthetic account after confirmation.
It is for testing, never presented as real market performance.

## Suggestions

Ideas rank recent daily price movement using an explicit rule and explain their
inputs. They are educational screens, not personalized advice, forecasts, or an
AI model that claims to predict profitable trades.

## Verification and architecture

Run `node --test tests/*.test.mjs` for the portfolio engine checks and
`npx tsc --noEmit` for type checking. API details are in `lib/API.md`.
The API validates trades server-side and uses versioned conditional writes to
prevent concurrent overspending. D1 stores account ledgers and daily snapshots.

For an employer demonstration, follow [DEMO_GUIDE.md](DEMO_GUIDE.md).

Implementation used bounded GPT-6 Luna agents for API, UI, and verification,
coordinated by GPT-6.1 Sol. No Astra escalation was needed.
