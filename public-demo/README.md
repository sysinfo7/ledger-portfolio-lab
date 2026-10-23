# Ledger employer demo

A standalone public stock trading simulation. Every quote, order, and performance
figure is synthetic. The app never contacts a brokerage or market-data provider.
Visitor portfolios and preferences are saved in that browser's local storage;
they are not synchronized between visitors or devices. Exports let reviewers
keep a copy. If browser storage is unavailable the app reports that limitation.

## Run

Use any static web server with `dist/` as its root. For example, with Python:

```
python -m http.server 8080 --directory dist
```

Open http://localhost:8080. Node 24 can run the deterministic engine tests with
`node --test tests/*.test.mjs`; no dependency installation is required.

The simulation starts on a fixed scenario date. **Advance day** and playback
advance virtual time; they do not represent live or predicted market prices.
The generator resets only the selected local test portfolio after confirmation.

## Two implementations

The public app is an accessible browser-native dashboard and deterministic engine.
The separate private application demonstrates server-side Alpaca IEX integration,
Cloudflare Worker APIs, D1 persistence, guarded virtual trades, and scheduled daily
valuations. Live data is shown privately during interviews. No live API keys,
private portfolio records, database state, or authentication credentials belong
in this public repository or its source download.

See `dist/employer-guide.html` for a walkthrough and architecture notes.
