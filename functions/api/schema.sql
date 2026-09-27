-- D1 schema for POST /api/report (D-22, §10.2, M2-18).
-- Apply once: Cloudflare dashboard → D1 → the database → Console, paste this file.
-- No IP addresses are stored: the rate limiter keeps a salted SHA-256 of the IP
-- for one hour, and report rows have no IP at all.

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL,   -- ms since the epoch
  app TEXT NOT NULL,              -- version + build commit
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  feature TEXT NOT NULL,
  error_code TEXT,                -- null when no error was attached
  session TEXT NOT NULL,          -- random per app session
  payload TEXT NOT NULL           -- the validated JSON, as the user saw it
);

CREATE INDEX IF NOT EXISTS reports_received ON reports (received_at);

CREATE TABLE IF NOT EXISTS report_rate (
  ip_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS report_rate_ip ON report_rate (ip_hash, at);
