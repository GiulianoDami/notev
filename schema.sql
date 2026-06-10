CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_date TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  hide_location INTEGER DEFAULT 0,
  link TEXT,
  image_url TEXT,
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  approvals INTEGER DEFAULT 0,
  reports INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL,
  ip TEXT NOT NULL,
  vote_type TEXT NOT NULL,  -- 'approve' or 'report'
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, ip, vote_type)
);