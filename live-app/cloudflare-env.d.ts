declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ALPACA_API_KEY?: string;
    ALPACA_API_SECRET?: string;
  }
}
