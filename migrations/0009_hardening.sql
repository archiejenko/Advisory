-- Hardening batch 2: x402 payments are used once. A payment payload's hash is claimed when it's verified, so the same
-- signed payment can't pay for several calls at once while only one of them settles. Pruned after a day by retention.
CREATE TABLE IF NOT EXISTS x402_payment (
  hash TEXT PRIMARY KEY,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS x402_payment_at ON x402_payment(at);
