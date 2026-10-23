# Paper market API

All state is stored in Cloudflare D1. The routes do not create or migrate tables at request time; apply the Drizzle migration generated from `db/schema.ts` before deployment. Account cash and trade prices are dollar values in account JSON; integer cash, values, and prices in the relational tables are cents.

## Read state

`GET /api/state?accountId=demo-synthetic-alex&mode=synthetic&symbol=AAPL`

`mode` is `synthetic` or `live` and defaults to `synthetic`. `accountId` defaults to the first seeded account. `symbol` selects the chart candle series and defaults to `SPY`. The response includes account picker data, current quote cards, holdings, the latest 100 trades, account history, candles, educational rule based suggestions, summary totals, and market status. The first read in each mode seeds Alex, Jordan, and Taylor with $100,000 each. Synthetic Alex starts with three dated buys; live accounts start with no holdings. Synthetic and live accounts are separate.

Synthetic prices are reproducible, seeded daily paths for AAPL, MSFT, NVDA, AMZN, GOOGL, META, TSLA, SPY, QQQ, and JPM. Live mode uses Alpaca's IEX stock snapshot and daily bar APIs and never substitutes synthetic values. Configure server only `ALPACA_API_KEY` and `ALPACA_API_SECRET`. A cached live quote is reused for ten seconds; quote freshness is recalculated at each read and quotes at least 120 seconds old are marked stale. Trades require a fresh live snapshot. Live requests fail with a clear 503 response when credentials or data are unavailable. If a live candle request fails, the state response keeps its quotes and portfolio data, returns an empty `candles` array, and puts the chart warning in `market.message`. Quote failures still return an error. No brokerage order endpoint is called.

## Mutations

`POST /api/state` accepts a JSON object with one of these actions:

- `{"action":"create","name":"Practice","initialCash":25000,"mode":"synthetic"}` creates a separate account and returns its `accountId`.
- `{"action":"trade","accountId":"demo-synthetic-alex","mode":"synthetic","symbol":"AAPL","side":"buy","quantity":2,"requestId":"order-123"}` places a simulated trade at the current quote. `requestId` is optional for older clients; when supplied, it must be 1–128 letters, numbers, dots, underscores, or hyphens and is stored with the trade. Repeating the same request ID and trade payload for the same account returns success without executing a second trade; reusing it for a different symbol, side, or quantity returns 409. Share quantities support four decimal places; cash and price math is rounded to cents. Insufficient cash or shares are rejected.
- `{"action":"generate","accountId":"demo-synthetic-alex","mode":"synthetic","days":365,"seed":2025,"confirmReset":true}` resets that selected synthetic account to a reproducible 30 to 1,825 day test ledger with dated buys, a partial sale, and daily saved valuations. The interface must ask for confirmation because this replaces that account's trades and snapshots. Live account generation is rejected; an explicit confirmation flag is required.
- `{"action":"snapshot","accountId":"demo-synthetic-alex","mode":"synthetic"}` stores that day's account valuation using current quotes. Normal state reads also upsert the current daily valuation. Synthetic history uses fixed-epoch deterministic prices; live history contains only persisted snapshots and never estimates past account values from trade prices.

`POST /api/daily` saves a current New York date snapshot for every live account using actual latest quotes for held symbols. It returns one saved/error result per account, with each saved result's `asOf` timestamp and `stale` flag to identify last-known quotes after market close, and a 503 when Alpaca credentials are missing. The deployment's private-site boundary must protect this route. No scheduler is configured here.

Account mutations use a versioned conditional D1 update and retry after conflicts, preventing concurrent orders from spending the same cash or selling the same shares twice. A repeated request ID is checked again after a version conflict, so concurrent retries of the same trade return the committed result. Synthetic history is generated from inception; live history includes every persisted snapshot from account inception. Errors return `{ "error": "..." }` with an appropriate HTTP status. This app provides paper simulation only and has no authentication; account selection is for a private demo site, not a public multi-user service.

Normal state reads and `POST /api/daily` persist daily valuations. D1 does not run an unattended daily scheduler by itself; configure a protected platform scheduler to call `/api/daily` if unattended records are needed.
