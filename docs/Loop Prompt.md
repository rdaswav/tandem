---
date: 2026-11-14
type: project
tags: [project]
---
# Loop Prompt

How to run the build with a smaller model, one task per iteration. Same method as the Quiet Feed build.

## Why it is set up this way

- **One task per iteration, fresh context each time.** State lives in files (the checkboxes in [[Build Plan]], git history, [[Changelog]]), not in the model's memory.
- **One objective gate.** `./scripts/verify.sh` decides whether a task is done. The model does not get to judge its own work.
- **Hard stops.** The loop halts at human tasks, at a blocked task, and when it wants a design change. It never improvises around those.
- **Narrow blast radius.** Each task lists the files it may touch. The NAS and the rest of the vault are off limits, and the private folders of the vault most of all.

## Start a session

After H01 to H03 in the Build Plan are done:

```bash
cd ~/Developer/tandem && claude --model sonnet --add-dir "$HOME/Library/Mobile Documents/iCloud~md~obsidian/Documents/RazPersonal/Projects/Tandem app"
```

Then type `/loop` followed by the prompt below. With no interval, the loop paces itself and ends when the prompt tells it to stop. Haiku is worth trying for T02, T05, T10 and T13 (pure logic with table tests). Use Sonnet for the rest, and for T03, T06 and T07 in particular, where the privacy rules live.

## The prompt

```text
You are building Tandem, a small private web app for two people, one task per iteration.

DOCS (read-only except where stated) are in:
/Users/raz/Library/Mobile Documents/iCloud~md~obsidian/Documents/RazPersonal/Projects/Tandem app
CODE is the current directory (~/Developer/tandem).

Each iteration, do exactly this:

1. Read "Build Plan.md". Find the first task, in document order, that is not marked [x] and not marked [-]. A task marked [-] is parked by Raz: skip it.
   - If it is marked [!], STOP the loop and say which task is blocked.
   - If its id starts with H, STOP the loop and tell Raz that task is waiting for him.
   - If every task is [x] or [-], STOP the loop and say the build is complete.
2. Read only the sections of "Architecture.md" and "Visual Design.md" that the task lists under Read, plus CLAUDE.md in the repo if it exists.
3. Implement that one task. Touch only the files it lists, plus its own test file and test/helpers.js. Write the tests the task asks for.
4. Run `./scripts/verify.sh`. If it fails, fix and rerun. You get three fix attempts.
5. If verify passes and every Accept line holds:
   - commit with message "<task id>: <short summary>"
   - change the task's [ ] to [x] in "Build Plan.md"
   - append one line to "Changelog.md" under Build: date, task id, what was built, anything surprising
   Then end the iteration.
6. If it still fails after three attempts:
   - leave the code uncommitted on a branch named blocked/<task id>
   - change the task's [ ] to [!] and write what failed, the last error, and what you tried under "Blocked notes" in "Build Plan.md"
   - STOP the loop.

Rules that always apply:
- Never do more than one task in an iteration, and never skip ahead.
- Never weaken, delete or skip a test, and never edit verify.sh or check-copy.mjs to make something pass. (T01 and T04 create them; after that they change only if a task lists them.)
- Never run ssh, docker, or deploy.sh without --dry-run. Never touch the network beyond `npm ci` and `npm install` of the dependencies named in Architecture section 2.
- Never add a dependency that Architecture section 2 does not name.
- Never push to any remote.
- All test and fixture text is invented and obviously fake (users are Ada and Bo). Never use real names, real messages or anything personal.
- Never change Architecture.md or Visual Design.md. If a task cannot be done as designed, write the problem and a proposed change under "Open questions" in Architecture.md, mark the task [!], and STOP.
- In the docs folder you may edit only Build Plan.md (checkboxes and Blocked notes), Changelog.md (append), and the Open questions section. Do not read or write anywhere else in that vault. In particular never open its Journal, Health, Reflections or Inbox folders.
- Do not use em dashes in anything you write, in the docs folder or in the app's copy.
```

## When the loop stops

| It stopped because | What to do |
|---|---|
| Next task is an H task | Do it (H04 is best done in a session with a stronger model), tick it, restart the loop |
| A task is `[!]` | Open a session with a stronger model, point it at the Blocked notes and the `blocked/<id>` branch, fix, tick the task, restart |
| Open question raised | Decide, update the design note, clear the question, set the task back to `[ ]`, restart |

## Review checkpoints for a stronger model

Worth a quick review before continuing, because later tasks build on them:

1. After T03: read `core/auth.js` end to end. Only hashes stored, constant-time comparison, the attempt limit cannot be reset by a successful guess for the other user, setup tokens die on use.
2. After T04: read the session guard and CSRF check in `server.js`. Look for any route registered before the guard.
3. After T07: sign in as each test user in a browser against a local run and try to see the other's draft: past rounds page, a past round by URL, a round for a future week by URL.
4. After T14: walk one talk on a phone-sized window with JavaScript off.
5. H04 covers the final pass before real use.
