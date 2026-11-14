CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  slot TEXT NOT NULL UNIQUE CHECK (slot IN ('a', 'b')),
  display_name TEXT NOT NULL,
  pass_hash TEXT,
  pass_salt TEXT,
  setup_token_hash TEXT,
  welcomed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE signin_attempts (
  user_id INTEGER NOT NULL REFERENCES users(id),
  at TEXT NOT NULL
);

CREATE TABLE rounds (
  id INTEGER PRIMARY KEY,
  week_start TEXT NOT NULL UNIQUE,
  rotating_prompt_id TEXT NOT NULL,
  revealed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE answers (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  prompt_id TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (round_id, user_id, prompt_id)
);

CREATE TABLE submissions (
  round_id INTEGER NOT NULL REFERENCES rounds(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  submitted_at TEXT NOT NULL,
  PRIMARY KEY (round_id, user_id)
);

CREATE TABLE moments (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  happened_on TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE ideas (
  id INTEGER PRIMARY KEY,
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'done', 'removed')),
  created_at TEXT NOT NULL,
  done_at TEXT
);

CREATE TABLE agreements (
  id INTEGER PRIMARY KEY,
  body TEXT NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('a', 'b', 'both')),
  source TEXT NOT NULL CHECK (source IN ('checkin', 'talk', 'direct')),
  source_id INTEGER,
  state TEXT NOT NULL CHECK (state IN ('open', 'done', 'dropped')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE talks (
  id INTEGER PRIMARY KEY,
  proposed_by INTEGER NOT NULL REFERENCES users(id),
  topic TEXT NOT NULL,
  hope TEXT,
  state TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 0,
  first_speaker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
