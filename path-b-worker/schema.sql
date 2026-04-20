CREATE TABLE IF NOT EXISTS provisioned_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  agent_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_provisioned_keys_agent ON provisioned_keys(agent_id);
