---
date: 2026-11-14
type: project
tags: [project]
---
# Architecture

Design for Tandem. The build loop reads only the sections a task names. It never edits this note except the Open questions section at the end.

## 1. Shape of the system

```
 Phone A (Safari, home screen)        Phone B (Safari, home screen)
            \                               /
             \____ home Wi-Fi, HTTP _______/
                          |
              NAS: Docker container "tandem"
              Node server, server-rendered HTML
              SQLite file in volume tandem_data
```

One process, one SQLite file, no external services, no outbound network calls at runtime.

## 2. Tech choices (fixed)

| Area | Choice | Why |
|---|---|---|
| Runtime | Node 24, ES modules, plain JavaScript, no build step | Nothing to compile, easy for a small model |
| Web framework | Fastify with `@fastify/cookie`, `@fastify/formbody`, `@fastify/static` | Small, and `app.inject()` gives fast route tests without a socket |
| Database | SQLite through the built-in `node:sqlite` (`DatabaseSync`) | No native module to compile on the NAS |
| Pages | Server-rendered HTML from template functions, forms that POST, almost no client JavaScript | Testable as strings, works without JS |
| Styling | Two hand-written CSS files, tokens as custom properties | See [[Visual Design]] |
| Tests | `node --test` with `node:assert/strict` | Built in |
| Passwords | `node:crypto` scrypt | Built in |

Do not add dependencies beyond these without raising an open question. No TypeScript, no bundler, no front-end framework, no ORM.

## 3. Repository layout

```
~/Developer/tandem
  CLAUDE.md
  package.json
  Dockerfile
  scripts/
    verify.sh            the single gate
    check-copy.mjs       banned words and characters in views
    create-users.mjs     makes the two users, prints setup links
    deploy.sh            tar over ssh to the NAS (never run by the loop)
  migrations/
    001_init.sql ...
  prompts/
    prompts.json         the check-in prompt pack
  public/
    tokens.css  app.css  talk.js  manifest.webmanifest  icon-180.png  icon-512.png
  src/
    server.js            buildApp({ db, clock, config }) and the listen entry point
    config.js
    db.js                open, migrate
    core/                pure logic and stores, no HTTP
      clock.js  week.js  auth.js  prompts.js  rounds.js
      moments.js  ideas.js  agreements.js  talks.js  export.js
    routes/              one file per area
      auth.js  home.js  checkin.js  moments.js  ideas.js  agreements.js  talks.js  export.js
    views/               template functions returning strings
      html.js  layout.js  and one file per screen
  test/
    helpers.js           makeApp() with an in-memory database and a fake clock
    *.test.js
  server/README.md       one-time NAS setup
```

Rules: `core/` never imports from `routes/` or `views/`. Routes do no SQL; they call `core/`. Every function that needs the time takes a clock.

## 4. Privacy and security rules

These are the point of the design. Tests enforce each one.

### 4.1 Check-in visibility

- A person's answers for a round are visible only to them until `rounds.revealed_at` is set.
- `revealed_at` is set in the same transaction as the second submission, and never otherwise.
- Before reveal, the other person can see only whether the round is "open" or "waiting for both". The app never says which of the two has or has not submitted. Each person sees their own state.
- If the week ends with fewer than two submissions, the round closes unrevealed and stays that way permanently. Each person can still read their own answers. The app says "This one passed." and nothing more.
- All reads of answers go through one function, `rounds.answersVisibleTo(roundId, userId)`. No route or view reads the `answers` table any other way.

### 4.2 Talks

- A talk stores: who proposed it, the topic line, the optional "what I hope for" line, its state and step, and timestamps. Nothing said during the talk is stored. Agreements made at the end are stored as agreements.
- Either person can pause or end a talk at any step, with no reason asked.

### 4.3 Accounts and sessions

- Exactly two users, slots `a` and `b`, created by `scripts/create-users.mjs`. There is no sign-up route and no way to make a third.
- Each user sets their own passphrase through a single-use setup link. Stored as scrypt hash with a per-user salt. Minimum 8 characters, no other rules.
- Session: 32 random bytes in a cookie `tandem_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`, 90 days). Only the SHA-256 of the value is stored. The cookie is not `Secure` because the app runs on plain HTTP at home.
- Sign-in attempts: after 5 wrong passphrases for a user within 10 minutes, further attempts are refused for 10 minutes.
- Every state change is a POST carrying a CSRF token bound to the session. A missing or wrong token gets 403.
- Every route except `/healthz`, `/signin`, `/setup/:token` and files under `/public` requires a session and otherwise redirects to `/signin`.
- Response headers on every page: `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on HTML.
- All user text is escaped by the `html` tagged template in `views/html.js`. Views never concatenate raw strings into markup.
- Logs contain method, path and status only. Never bodies, never answer text, never passphrases.

### 4.4 The server owner

Raz runs the NAS and can open the SQLite file. The app cannot prevent that and does not pretend to. The welcome screen says so (copy in [[Visual Design]]). Encrypting unrevealed answers with a key derived from each passphrase is noted under Out of scope; build it only if H01 asks for it.

### 4.5 Ownership

- A person can edit or remove only the moments and ideas they wrote.
- Agreements belong to both. Either person can mark one done or drop it. The text is not editable; drop it and make a new one.
- Removing is a soft delete (`deleted_at` or a state), so nothing vanishes from the other person's view without a trace in the database, but removed items are never shown.

## 5. Data model

All timestamps are ISO 8601 UTC strings. Dates (`happened_on`, `week_start`) are `YYYY-MM-DD` in the configured time zone.

```sql
users(id INTEGER PRIMARY KEY, slot TEXT UNIQUE CHECK(slot IN ('a','b')),
      display_name TEXT NOT NULL, pass_hash TEXT, pass_salt TEXT,
      setup_token_hash TEXT, welcomed_at TEXT, created_at TEXT NOT NULL)

sessions(id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, csrf TEXT NOT NULL,
         created_at TEXT NOT NULL, expires_at TEXT NOT NULL)

signin_attempts(user_id INTEGER NOT NULL, at TEXT NOT NULL)

rounds(id INTEGER PRIMARY KEY, week_start TEXT UNIQUE NOT NULL,
       rotating_prompt_id TEXT NOT NULL, revealed_at TEXT, created_at TEXT NOT NULL)

answers(round_id INTEGER, user_id INTEGER, prompt_id TEXT, body TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY(round_id, user_id, prompt_id))

submissions(round_id INTEGER, user_id INTEGER, submitted_at TEXT NOT NULL,
            PRIMARY KEY(round_id, user_id))

moments(id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, happened_on TEXT NOT NULL,
        body TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT)

ideas(id INTEGER PRIMARY KEY, author_id INTEGER NOT NULL, body TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('open','done','removed')),
      created_at TEXT NOT NULL, done_at TEXT)

agreements(id INTEGER PRIMARY KEY, body TEXT NOT NULL,
           owner TEXT NOT NULL CHECK(owner IN ('a','b','both')),
           source TEXT NOT NULL CHECK(source IN ('checkin','talk','direct')),
           source_id INTEGER, state TEXT NOT NULL CHECK(state IN ('open','done','dropped')),
           created_by INTEGER NOT NULL, created_at TEXT NOT NULL, closed_at TEXT)

talks(id INTEGER PRIMARY KEY, proposed_by INTEGER NOT NULL, topic TEXT NOT NULL, hope TEXT,
      state TEXT NOT NULL, step INTEGER NOT NULL DEFAULT 0, first_speaker TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, closed_at TEXT)
```

Length limits, enforced in `core/`: answer, moment, idea 2000 characters; agreement 300; talk topic 140; talk hope 300; display name 40. Empty or whitespace-only text is rejected.

Migrations are numbered SQL files applied in order inside a transaction, tracked in a `schema_migrations` table. A task that changes the schema adds a new file and never edits an old one.

## 6. Features

### 6.1 Weeks and rounds

- Config: `TZ` (default `Australia/Melbourne`) and `CHECKIN_START_DAY` (0 to 6, 0 is Sunday, default 0).
- `week.weekStart(instant, tz, startDay)` returns the local date of the most recent start day at or before that instant. A round covers seven local days from its `week_start`.
- The round for the current week is created the first time either person opens the check-in. Past weeks with no round simply have none.
- The time zone maths uses `Intl.DateTimeFormat` with the `timeZone` option. No date library.

### 6.2 Prompt pack

`prompts/prompts.json`:

```json
{
  "version": 1,
  "fixed": [
    { "id": "appreciated", "text": "Something I appreciated about you this week" },
    { "id": "hard",        "text": "Something that was hard for me this week" },
    { "id": "need",        "text": "Something I would like more of, or need" },
    { "id": "next",        "text": "One thing I would like us to do in the coming week" }
  ],
  "rotating": [ { "id": "r01", "text": "..." } ]
}
```

- Validator: ids unique, lower case letters, digits and underscore; text 1 to 140 characters; `fixed` has 1 to 6 entries; `rotating` has at least 12.
- A round's rotating prompt is chosen when the round is created: index = (number of days from 2026-01-04 to `week_start`, divided by 7) modulo the length of `rotating`. Stored on the round so later edits to the pack do not change old rounds.
- A fixed prompt removed from the pack later still shows in old rounds, labelled by its stored id if the text is gone.
- Prompts are about the writer's own week and wishes. None asks one person to rate the other.

### 6.3 Check-in flow

1. Draft: answers save on POST and can be changed freely. At least one answer is needed to submit; blank ones are allowed.
2. Submit: locks that person's answers for the round.
3. Reveal: when the second submission lands. Both sets show side by side, with the open agreements listed above them for a quick look back, and a field to add "one thing for the week", which creates an agreement with source `checkin`.
4. Passed: see 4.1.

### 6.4 Moments and ideas

- A moment: a date (default today, not in the future) and text. Visible to both at once. Listed newest first, grouped by month.
- "From the log": Home shows one earlier moment, at least 14 days old, picked by (day number of today) modulo (count of eligible moments), ordered by id. Same moment all day for both people. None if there are no eligible moments.
- An idea: one line of something to do together. States open, done, removed. Marking one done offers a link to add a moment about it, nothing automatic.

### 6.5 Agreements

- Fields per section 5. Owner is one of the two people or both, shown by display name.
- Home lists open agreements, oldest first. No dates beside them, no age, no colour change over time.
- Done and dropped ones sit on a separate "Earlier" page.

### 6.6 Talks

A pure state machine in `core/talks.js`: `next(talk, action, actorSlot) -> talk or error`.

| State | Actions allowed | Goes to |
|---|---|---|
| `proposed` | `accept` (other person only), `not_now` (other person only), `withdraw` (proposer only) | `ready`, `set_aside`, `withdrawn` |
| `ready` | `start` (either; sets `first_speaker` to the proposer's slot, step 1) | `in_progress` |
| `in_progress` | `advance` (either), `pause` (either), `end` (either) | next step or `closing` after the last, `paused`, `closed` |
| `paused` | `resume` (either), `end` (either) | `in_progress` at the same step, `closed` |
| `closing` | `finish` (either) | `closed` |
| `set_aside`, `withdrawn`, `closed` | none | |

Steps while `in_progress`: 1 ground rules, 2 first speaker talks, 3 the other says back what they heard, 4 second speaker talks, 5 the first says back what they heard, 6 what we each need, 7 agreements. Screen copy for each step is in [[Visual Design]]. `set_aside` is not a refusal; the copy says "Not now" and the proposer may propose again later. Only one talk can be in `proposed`, `ready`, `in_progress`, `paused` or `closing` at a time.

The talk screen is meant for one phone on the table between them, but the state lives on the server so either phone shows the current step. The optional three minute timer on steps 2 and 4 is client side only (`public/talk.js`), is never stored, and the page works without it.

### 6.7 Home

In this order, each block omitted when empty: this week's check-in (your own state and a link), a talk waiting for an answer or in progress, open agreements, one moment from the log, quick links to add a moment or an idea.

### 6.8 Export

Each person can download one JSON file with everything they are allowed to see: revealed rounds, their own answers in unrevealed rounds, moments, ideas, agreements, and talk topics with states. Never the other person's unrevealed answers.

## 7. Routes

| Method and path | Purpose |
|---|---|
| GET `/healthz` | `{"ok":true}` |
| GET, POST `/setup/:token` | Set a passphrase once |
| GET, POST `/signin`, POST `/signout` | Session |
| GET `/welcome`, POST `/welcome/done` | First-run pages |
| GET `/` | Home |
| GET `/checkin`, POST `/checkin/save`, POST `/checkin/submit` | This week's round |
| GET `/checkin/past`, GET `/checkin/:weekStart` | Earlier rounds |
| GET `/moments`, POST `/moments`, POST `/moments/:id/edit`, POST `/moments/:id/remove` | Moments |
| GET `/ideas`, POST `/ideas`, POST `/ideas/:id/done`, POST `/ideas/:id/remove` | Ideas |
| GET `/agreements`, GET `/agreements/earlier`, POST `/agreements`, POST `/agreements/:id/done`, POST `/agreements/:id/drop` | Agreements |
| GET `/talks`, POST `/talks`, GET `/talks/:id`, POST `/talks/:id/:action` | Talks |
| GET `/export.json` | Export |

POSTs answer with a 303 redirect to the page that shows the result. Validation errors re-render the form with the entered text kept and a plain message.

## 8. NAS deployment

- `Dockerfile`: `node:24-slim`, `npm ci --omit=dev`, runs as the `node` user, `CMD ["node","src/server.js"]`, data directory `/app/data`.
- Config by environment: `PORT` (8790), `DATA_DIR` (`/app/data`), `TZ`, `CHECKIN_START_DAY`.
- `scripts/deploy.sh`: runs `./scripts/verify.sh`, sends the tracked files with `git archive HEAD | ssh nas "..."` into `/volume1/docker/tandem/src`, builds the image there with `sudo /usr/local/bin/docker build`, then stops, removes and re-runs the container with `--restart unless-stopped -p 8790:8790 -v tandem_data:/app/data`. Supports `--dry-run`, which prints the commands and touches nothing. It refuses to run if the work tree is dirty.
- Backup: point Hyper Backup at `/volume1/@docker/volumes/tandem_data/_data`.
- The loop never runs `deploy.sh` without `--dry-run`, and never runs `ssh` or `docker`.

## 9. Testing strategy

`./scripts/verify.sh` is the only gate. Stages, each printing its name, stopping at the first failure:

1. `npm ci` if `node_modules` is missing or older than `package-lock.json`.
2. `node --test` over `test/`.
3. `node scripts/check-copy.mjs`: no em dash and none of the banned words from Visual Design (Copy rules) in `src/views` or `prompts`.
4. Colour check: no hex colour or `rgb(` outside `public/tokens.css` (grep over `public` and `src`).
5. Layering check: no file under `src/core` imports from `routes` or `views`; no file outside `src/core/rounds.js` contains the string `FROM answers`.
6. `bash -n` on every script in `scripts/`.

`--fast` runs stage 2 only. Stages 3 to 6 skip cleanly with a printed notice while their directories do not exist yet.

Test rules: every test builds its own app with `makeApp()` (in-memory database, fake clock, two users `Ada` and `Bo` with known passphrases). Fixture text is invented and obviously fake. Never copy real personal content into a test. Privacy tests assert on rendered HTML and on export output, not only on store functions.

## 10. Out of scope for v1

Notifications and reminders, photos, access away from home, HTTPS, encryption of unrevealed answers at rest, charts or history analysis, any AI feature, any import from or export to the vault, more than two users, comments or reactions on each other's entries.

## Open questions

(The loop writes here when a task cannot be done as designed: task id, the problem, a proposed change.)
