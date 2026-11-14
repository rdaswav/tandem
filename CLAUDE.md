# Tandem

A small private web app for two people. Node 24, Fastify, built-in SQLite, server-rendered HTML. Design lives in the vault note folder "Tandem app" (Architecture and Visual Design); the build plan there decides what to do next.

## Rules

- Run `./scripts/verify.sh` before committing. `./scripts/verify.sh --fast` runs the tests only.
- One task per commit, message `T01: summary` (task id, colon, short summary).
- After a passing task, push its commit to `origin main` (the private rdaswav/tandem repo). Scan the unpushed commits for secrets and LAN addresses first. Never force-push, and never push another branch or tag.
- `src/core/` never imports from `src/routes/` or `src/views/`. Routes do no SQL; they call `core/`.
- Only `src/core/rounds.js` may read the `answers` table. Everything else goes through `rounds.answersVisibleTo`.
- No colour values (hex or `rgb(`) outside `public/tokens.css`.
- Never commit a LAN address, a passphrase, a token or real personal text. Test and fixture text is invented (users are Ada and Bo).
- Logs carry method, path and status only. Never request bodies.
- No new dependencies beyond fastify, @fastify/cookie, @fastify/formbody and @fastify/static.
- Never run ssh, docker or `scripts/deploy.sh` (without `--dry-run`) from a build loop.
- No em dashes in code comments, docs or app copy.
