# Employer demonstration

## Three minute walkthrough

1. Open the hosted app and select **Live feed**. Point out the Alpaca IEX provider,
   exchange coverage, quote timestamp, and daily stock price chart. Explain that
   prices refresh every 15 seconds and the provider key stays on the server.
2. Choose a named portfolio. Show starting capital, cash, current position values,
   total return, and the comparison chart. Each name has a separate server-saved
   ledger. These are shared demo personas rather than authenticated customer accounts.
3. During market hours, submit a small paper buy and sell. Explain that the API
   checks available cash and shares and never sends brokerage orders. If quotes
   are stale, demonstrate the disabled live order state, then use **Synthetic**
   mode for the order demonstration instead.
4. Create a separate synthetic portfolio for testing. Open **Generate history**,
   choose a duration and seed, and confirm the reset for that test portfolio.
   Show the resulting trades, holdings, and performance chart. The synthetic
   prices are prominently labeled and never mixed into live accounts.
5. Export history as CSV or JSON. Reload the page to demonstrate server persistence.
   Show the daily snapshot schedule and explain that actual live history grows
   from observed valuations rather than fabricated historical performance.
6. Explain an idea in **Ideas to explore**. Its score and rule are visible; it is
   a transparent educational screen rather than a claim to predict returns.

## Engineering evidence

- The market API runs server-side on a Cloudflare Worker. Alpaca credentials are
  secret runtime variables and are excluded from source control.
- D1 stores the account ledger and daily portfolio valuations. Conditional
  version writes protect against competing updates to the same balance.
- Tests cover trading arithmetic, account isolation, deterministic scenarios,
  concurrent requests, and provider failure handling.
- The project includes a Docker setup, a persistent local data volume, and a
  GitHub Actions workflow for tests, type checking, and production builds.
- The free IEX feed represents one exchange. The app labels its scope rather
  than presenting it as consolidated US market data.

## Access

The deployed Site is owner-private. Present it while signed in or arrange an
explicit sharing plan before sending it to an employer. A public deployment
would need a separate review of shared portfolio access and market-data display
permissions. Screenshots and synthetic demo data do not require exposing API keys.
