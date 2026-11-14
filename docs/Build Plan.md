---
date: 2026-11-14
type: project
tags: [project]
---
# Build Plan

Ordered tasks for building Tandem. Written so a smaller model can do one task per loop iteration with a fresh context. Design detail lives in [[Architecture]] and [[Visual Design]]; each task names the sections it needs.

## How to read a task

- `[ ]` not started, `[x]` done, `[!]` blocked (a note explains why), `[-]` parked by Raz (the loop skips it).
- **H tasks** are for Raz, some with his wife. The loop never does them and stops when the next task in order is an H task.
- **T tasks** are for the loop. Do them strictly in order. Each one lists the files it may touch; touching anything else is out of bounds. Every T task may also add its own `test/*.test.js` file and extend `test/helpers.js`.
- **Accept** is the definition of done. Unless stated otherwise it means `./scripts/verify.sh` exits 0 and the listed checks hold.
- Paths are relative to the code repo `~/Developer/tandem`.

## Phase 0: before any code (human)

- [x] **H01 Talk to her first.** Show her the README and the screens in Visual Design. Ask: does she want this at all; which of the four parts appeal and which do not; do the check-in prompts read right; which day the week starts; what colour; what name; is she comfortable with the note about the home server (Architecture 4.4), or does she want unread answers encrypted. Write the answers under "Decisions from H01" in the README. If a part is not wanted, mark its tasks `[-]`. If the design changes, update Architecture and Visual Design (a session with a stronger model is best for that) before T01.
- [x] **H02 Create the repo.** Done 2026-11-14: `~/Developer/tandem`, branch main, local only. `mkdir -p ~/Developer/tandem && cd ~/Developer/tandem && git init -b main`. Keep it local or in a private remote.
- [x] **H03 Check the NAS port.** Done 2026-11-14: 8790 is free (NAS uses 8787, 8000, 3000); keep 8790. `ssh nas "sudo /usr/local/bin/docker ps --format '{{.Names}} {{.Ports}}'"` and confirm nothing uses 8790. If something does, write the chosen port here before T19 runs.

## Phase 1: skeleton, time, accounts

- [x] **T01 Repo skeleton.**
  - Read: Architecture 2, 3, 9.
  - Files: `.gitignore`, `CLAUDE.md`, `package.json`, `package-lock.json`, `scripts/verify.sh`, `src/server.js`, `src/config.js`, `src/db.js`, `migrations/001_init.sql`, `test/helpers.js`, `test/smoke.test.js`.
  - Do: `package.json` with `"type": "module"`, `"engines": {"node": ">=24"}` and the four dependencies in Architecture 2. `buildApp({ db, clock, config })` returns a Fastify instance with `GET /healthz`. `db.js` opens a `DatabaseSync` (file path or `:memory:`), turns on foreign keys and WAL for files, and applies migrations per Architecture 5. `001_init.sql` creates every table in Architecture 5. `verify.sh` implements the stages in Architecture 9 with `--fast`. `CLAUDE.md` states: run `./scripts/verify.sh` before committing; one task per commit, message `T01: summary`; `core/` never imports from `routes/` or `views/`; no colour values outside `public/tokens.css`; never commit a LAN address, a passphrase or real personal text; fixtures are invented. `.gitignore` covers `node_modules`, `data`, `*.sqlite*`, `.env`.
  - Accept: verify passes; tests cover `/healthz` returning 200 and migrations applying twice without error on the same database; `git status` is clean after commit.

- [x] **T02 Clock and week maths.**
  - Read: Architecture 6.1.
  - Files: `src/core/clock.js`, `src/core/week.js`.
  - Do: `systemClock` and `fakeClock(iso)` with `now()` and `set()`. `localDate(instant, tz)`, `weekStart(instant, tz, startDay)`, `addDays(dateString, n)`, `daysBetween(a, b)`.
  - Accept: table-driven tests with at least 15 rows, including: an instant that is Saturday in UTC but Sunday in Melbourne; both daylight saving changes in Melbourne; start day 0 and start day 1; the start day itself returns that same date; year boundary.

- [x] **T03 Users, setup links, sessions.**
  - Read: Architecture 4.3, 5.
  - Files: `src/core/auth.js`, `scripts/create-users.mjs`.
  - Do: `createUsers(db, nameA, nameB)` (refuses if any user exists) returning two single-use setup tokens; `completeSetup(token, passphrase)`; `signIn(userId, passphrase)` with the attempt limit; `createSession`, `sessionFromCookie`, `signOut`; CSRF token per session. The script takes two names, uses `DATA_DIR`, and prints the two setup paths (`/setup/<token>`), nothing else. Constant-time comparison for hashes.
  - Accept: tests cover: third user impossible; setup token works once and only once; passphrase under 8 characters refused; right and wrong passphrase; sixth attempt inside 10 minutes refused even with the right passphrase and allowed again after 10 minutes (fake clock); expired session rejected; only hashes are stored (assert the raw token and passphrase appear in no table).

- [x] **T04 Views foundation, tokens and the signed-in shell.**
  - Read: Visual Design (Tokens, Layout, Sign in and setup, Copy rules); Architecture 4.3, 7.
  - Files: `src/views/html.js`, `src/views/layout.js`, `src/views/auth.js`, `src/routes/auth.js`, `src/routes/home.js`, `src/views/home.js`, `src/server.js`, `public/tokens.css`, `public/app.css`, `public/manifest.webmanifest`, `public/icon-180.png`, `public/icon-512.png`, `scripts/check-copy.mjs`.
  - Do: the `html` tagged template that escapes every interpolated value unless wrapped in `raw()`. Layout with the bottom bar, the home screen meta tags and the manifest. Routes for setup, sign in, sign out. A session guard, CSRF check on every POST, and the response headers in 4.3, all registered once in `server.js`. Home is a placeholder with the title only. Generate the two icons with a short throwaway Node script that is not committed.
  - Accept: verify passes; tests cover: escaping of `<script>` and quotes in a display name on a rendered page; every route in Architecture 7 that exists so far redirects to `/signin` without a session; a POST without a CSRF token gets 403; the headers are present; a test parses `tokens.css` and checks the two contrast ratios named in Visual Design for light and dark.

## Phase 2: weekly check-in

- [x] **T05 Prompt pack.**
  - Read: Architecture 6.2.
  - Files: `prompts/prompts.json`, `src/core/prompts.js`.
  - Do: write the pack with the four fixed prompts and 16 rotating questions. Rotating questions are light and about the writer or the two together (for example "A small thing that made me laugh this week", "Somewhere I would like us to go one day"). None asks one person to rate or assess the other. Loader, validator, and `rotatingFor(weekStart)`.
  - Accept: tests cover one failing case per validator rule, the shipped pack passing, and `rotatingFor` being stable for a week and moving on the next week; `check-copy.mjs` passes over `prompts`.

- [x] **T06 Rounds store and the visibility rule.**
  - Read: Architecture 4.1, 6.1, 6.3.
  - Files: `src/core/rounds.js`.
  - Do: `currentRound(db, clock, config)` (get or create), `saveDraft`, `submit`, `stateFor(round, userId)` returning one of `not_started`, `draft`, `waiting`, `revealed`, `passed`, and `answersVisibleTo(roundId, userId)`. Reveal happens inside the transaction of the second submit.
  - Accept: tests cover: A's answers absent from `answersVisibleTo` for B before reveal and present after; a draft cannot be changed after submit; submit with no answers refused; second submit sets `revealed_at`; a round whose week has ended with one submission is `passed` for both and B still cannot see A's answers; `stateFor` gives B the same value whether or not A has submitted (both `not_started` or `draft` cases checked); length limit and whitespace-only refused.

- [x] **T07 Check-in screens.**
  - Read: Visual Design (Check-in: writing, reading together, passed); Architecture 6.3, 7.
  - Files: `src/routes/checkin.js`, `src/views/checkin.js`, `src/server.js`.
  - Do: the three screens, the past rounds list and a past round page. The "One thing for the week" field is added in T12; leave it out for now.
  - Accept: verify passes; route tests sign in as each user and assert: before reveal, B's `/checkin` HTML and `/checkin/past` HTML contain none of A's answer strings and no wording that shows whether A has submitted; after reveal both pages show both sets with slot `a` first; a passed round shows only the viewer's own answers.

## Phase 3: moments and ideas

- [x] **T08 Moments.**
  - Read: Architecture 4.5, 6.4; Visual Design (Moments).
  - Files: `src/core/moments.js`, `src/routes/moments.js`, `src/views/moments.js`, `src/server.js`.
  - Accept: tests cover: add, list grouped by month newest first, future date refused, edit and remove by the author only (the other person gets 403 and the row is unchanged), removed moments never listed, `fromTheLog` returns the same moment for both users on one day, a different eligible one on another day, and none when nothing is 14 days old.

- [x] **T09 Ideas.**
  - Read: Architecture 4.5, 6.4; Visual Design (Moments).
  - Files: `src/core/ideas.js`, `src/routes/ideas.js`, `src/views/moments.js`, `src/views/ideas.js`, `src/server.js`.
  - Accept: tests cover add, done by either person, remove by the author only, the tab links, and the "add a moment about it" link appearing after done.

## Phase 4: agreements

- [x] **T10 Agreements store.**
  - Read: Architecture 4.5, 5, 6.5.
  - Files: `src/core/agreements.js`.
  - Accept: tests cover create with each owner and each source, done and drop by either person, no change once closed, open list oldest first, length limit.

- [x] **T11 Agreements screens.**
  - Read: Visual Design (Agreements); Architecture 7.
  - Files: `src/routes/agreements.js`, `src/views/agreements.js`, `src/server.js`.
  - Accept: verify passes; tests assert the open page and the Earlier page show no dates, ages or counts (no digits in the list markup apart from those in fixture text).

- [x] **T12 Check-in meets agreements.**
  - Read: Architecture 6.3; Visual Design (Check-in: reading together).
  - Files: `src/routes/checkin.js`, `src/views/checkin.js`.
  - Do: on the revealed screen add the "Looking back" list and the "One thing for the week" form, which creates an agreement with source `checkin` and the round id.
  - Accept: tests cover: the form is absent before reveal and a POST to it before reveal is refused; after reveal it creates the agreement and it shows on `/agreements`.

## Phase 5: talks

- [x] **T13 Talk state machine.**
  - Read: Architecture 4.2, 6.6.
  - Files: `src/core/talks.js`.
  - Do: the pure `next()` function and a store around it. Only one active talk at a time.
  - Accept: a table-driven test with one row per cell of the table in 6.6, plus: every action not listed for a state is refused; the proposer cannot accept their own talk; pause and resume keep the step; a second proposal while one is active is refused; the `talks` table has no column that could hold what was said (assert the column list).

- [x] **T14 Talk screens.**
  - Read: Visual Design (Talks, Home for the proposal card); Architecture 6.6, 7.
  - Files: `src/routes/talks.js`, `src/views/talks.js`, `public/talk.js`, `src/server.js`.
  - Do: list and ask form, the step screen with the copy table, paused and closed screens, the agreement form on step 7 (source `talk`). The timer is plain JavaScript under 60 lines, counts down on screen only, and the page is complete without it.
  - Accept: verify passes; tests walk a whole talk through `app.inject` as two users and check the heading at each step uses the right names in the right order; either user can pause and end at any step.

## Phase 6: home, welcome, export, finish

- [x] **T15 Home.**
  - Read: Architecture 6.7; Visual Design (Home).
  - Files: `src/routes/home.js`, `src/views/home.js`.
  - Accept: tests cover each block appearing and being omitted when empty, the four check-in state lines, the proposal card for the other person and the waiting card for the proposer, and that B's Home is identical in its check-in block whether or not A has submitted.

- [x] **T16 Welcome pages.**
  - Read: Visual Design (Welcome); Architecture 4.4.
  - Files: `src/routes/auth.js`, `src/views/welcome.js`, `src/views/home.js`, `src/server.js`. (`src/views/home.js` added by Raz and Claude on 2026-11-14: the plan asked for a link at the foot of Home but did not list the Home view.)
  - Accept: shown once per person after first sign-in, skippable, reachable again from a small link at the foot of Home; the third page's text matches Visual Design word for word.

- [x] **T17 Export.**
  - Read: Architecture 6.8.
  - Files: `src/core/export.js`, `src/routes/export.js`, `src/views/home.js`, `src/server.js`.
  - Accept: tests cover: B's export before reveal contains none of A's answer strings; after reveal it contains both; a passed round exports only the viewer's own answers; removed moments and ideas are absent.

- [x] **T18 Accessibility and copy pass.**
  - Read: Visual Design (all).
  - Files: `src/views/*.js`, `public/app.css`.
  - Do: every field has a label, every page has one `h1`, headings in order, focus ring visible, targets at least 44px, the layout holds at 200 percent text size and 320px width, all copy checked against the copy rules. The design-system pass of 2026-11-14 already fixed four things the iPhone simulator look found (the bottom bar word break, card spacing, quiet button alignment and the Moments tabs; see the Changelog), so re-check them but do not redo them. Still to do: iOS offers to save the passphrase but asks for a username because the setup and sign-in forms have none, so add a visually hidden `autocomplete="username"` field holding the person's display name (and add a test that it is present and holds no secret). Then look again in the simulator at 320pt width, in dark mode and at the largest text size, since the first look covered only 402pt in light.
  - Accept: verify passes; a test renders every GET route as a signed-in user and asserts one `h1` and that every `input`, `textarea` and `select` has a matching `label`. Say in the changelog how you checked the 200 percent and 320px cases.

- [x] **T19 Dockerfile, deploy script, server notes.**
  - Read: Architecture 8. The port line under H03 above.
  - Files: `Dockerfile`, `.dockerignore`, `scripts/deploy.sh`, `server/README.md`.
  - Do: write the files. `server/README.md` gives the first deploy, how to run `create-users.mjs` inside the container, the Hyper Backup path, how to add the app to an iPhone home screen, and the optional `SERVER_OWNER` setting (the name shown on the third welcome page as the person who looks after the server; if it is not set the app uses the first person). `deploy.sh` passes `SERVER_OWNER` through to the container when it is set in the environment, and never writes a name into a committed file. Use host alias `nas` only; never write an IP address. Do not run anything against the NAS.
  - Accept: verify passes; `./scripts/deploy.sh --dry-run` prints the commands and exits 0 without network access; a git grep for private network address prefixes (the exact command is in test/deploy.test.js) returns nothing. (The lock file is excluded on 2026-11-14 by Raz and Claude: npm writes version numbers such as a nine-dot-ten version tarball name into it that look like an address but are not one, and a generated file is not edited by hand.)

- [x] **H04 Review before it goes live.** In a session with a stronger model, read `core/auth.js`, `core/rounds.js`, the session guard in `server.js` and `core/export.js` end to end against Architecture 4. Fix anything found, then tick. Done 2026-11-14: no way found to read the other person's hidden answers; two fixes (setup tokens kept out of the log, 8298f99; no server error on odd sign-in and talk values, 0ad9dcc). Design questions left open: setup links never expire, and one person can be locked out by anyone on the Wi-Fi.
- [ ] **T20 Passphrase reset script.** Added 2026-11-15 from the H04 review (design question 3), by Raz's choice.
  - Read: Architecture 4 (setup links, sessions, sign-in attempts).
  - Files: `src/core/auth.js`, `scripts/reset-passphrase.mjs`, `Dockerfile`, `server/README.md`.
  - Do: add `core/auth.js` `issueResetLink(db, clock, name)`. In one transaction it finds the person by display name (exact match, refuses if none or more than one), clears their passphrase hash, stores a new hashed one-time setup token, deletes all of their rows in `sessions` (so every phone is signed out) and clears their rows in `signin_attempts`. It returns the raw token once. The existing setup page then lets them choose a new passphrase and signs them in; check `completeSetup` accepts a person who already has a passphrase hash cleared this way, and change it only as far as needed. The script `reset-passphrase.mjs <name>` prints only `/setup/<token>` on stdout, like `create-users.mjs`, and never prints a passphrase or hash. Copy it into the image in the `Dockerfile`. `server/README.md` replaces the "Known gap" section with the command to run inside the container and says plainly that it signs the person out everywhere.
  - Accept: verify passes; tests cover: after a reset the old passphrase no longer signs in and the old session cookie no longer works; the other person's passphrase and sessions are untouched; the new link works once and then fails; an unknown name and a duplicate name are refused; the token is stored only as a hash; the script prints one line and the request log still hides the token. The privacy rule is untouched: nothing here reads the `answers` table.

- [ ] **T21 Consistent backup snapshot.** Added 2026-11-15 from the H04 review (design question 4), by Raz's choice.
  - Read: Architecture 8 (deployment and backup).
  - Files: `src/core/backup.js`, `src/server.js`, `server/README.md`.
  - Do: the database runs in WAL mode, so copying the live `tandem.sqlite` file alone can miss recent writes or catch it half way. Add `core/backup.js` `writeSnapshot(db, dir, clock)`: runs `VACUUM INTO` a temporary file in `<dataDir>/backup/`, then renames it over `tandem-snapshot.sqlite` so a reader never sees a partial file, and keeps only that one file. No new dependency. In `server.js` take a snapshot at start and then every 24 hours with an unref'd timer, never in tests unless a test turns it on, and log only the word "snapshot" with no content. `server/README.md` says Hyper Backup should point at the `backup` folder inside the data volume (`/volume1/@docker/volumes/tandem_data/_data/backup`), not at the live file, and how to restore from a snapshot.
  - Accept: verify passes; tests cover: a snapshot opens as a valid database holding the rows written before it; a snapshot taken while the source has uncommitted WAL data still holds the committed rows; the old snapshot is replaced, not accumulated; a failed write leaves the previous snapshot intact; nothing is written outside `<dataDir>/backup/`. The snapshot holds hidden answers like the live file does, so the README notes it must be treated the same way. Only `src/core/rounds.js` reads the `answers` table; `VACUUM INTO` copies pages and does not break that rule.

- [ ] **H05 Deploy.** Run `./scripts/deploy.sh`, open `http://<nas>:8790/healthz` from a phone on home Wi-Fi, and set Hyper Backup on the data folder.
- [ ] **H06 Create the two users.** Run the create-users script per `server/README.md`. Send her link to her yourself; each of you sets your own passphrase on your own phone and adds the app to the home screen.
- [ ] **H07 First check-in together.** Do one round. Note anything awkward in [[Changelog]] under "Field notes".
- [ ] **H08 Live with it for four weeks.** Then decide together what stays, what goes, and whether reminders or access away from home earn a v2.

## Blocked notes

(The loop writes here when it marks a task `[!]`: task id, what failed, the last error output, what it tried.)
