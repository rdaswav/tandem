---
date: 2026-11-14
type: project
tags: [project]
---
# Tandem

A small private web app for two people, Raz and his wife, served from the NAS and added to each phone's home screen. It holds a weekly check-in, a log of good moments, a guide for hard conversations and a list of agreements. Working name only; rename freely.

**Status:** design drafted, build not started. Next action is H01 in [[Build Plan]]: talk to her before anything is built.

## What is in this folder

| Note | Purpose |
|---|---|
| [[Architecture]] | Code design: stack, data model, privacy rules, routes, testing, NAS deploy |
| [[Visual Design]] | Look and feel, tokens, screen wireframes, copy rules |
| [[Build Plan]] | Ordered task list written for a smaller model to execute one task per loop iteration |
| [[Loop Prompt]] | The exact prompt and commands to run the build loop |
| [[Changelog]] | One line per completed task or design change. The loop appends here |

There is no Research note. The four features are well-known formats (a weekly check-in, a gratitude log, a speaker and listener structure, a list of commitments), so nothing needed investigating.

## Scope decisions (14 Nov 2026)

| Question | Decision |
|---|---|
| Features in v1 | Weekly check-in, good moments log with an ideas list, hard conversation helper, agreements |
| Left out on purpose | "Prep from the vault" (drafting things to share from journal or therapy notes). Nothing in this app reads the vault |
| Route | Web app in Docker on the NAS, opened in Safari and added to the home screen |
| Reach | Home Wi-Fi only in v1. Remote access (for example Tailscale) is a later decision |
| Users | Exactly two, equal. No admin role inside the app |
| Out of v1 | Notifications, photos, charts or scores of any kind, AI features, native app, access away from home |

## Principles

1. **Two equal users.** Neither person has a view, a control or a statistic the other lacks.
2. **Private until both are ready.** A check-in answer is hidden from the other person until both have submitted.
3. **No scores, streaks or overdue marks.** The app records and reminds. It never grades either person or the relationship.
4. **Says little about hard conversations.** A talk stores its topic and any agreements that came out of it, never what was said.
5. **Separate from the vault.** The app holds its own data on the NAS. The build loop never reads `Journal/`, `Health/` or `Reflections/`, and no vault content is ever used as a fixture.
6. **Honest about the server.** Raz runs the NAS, so he could technically open the database. The welcome screen says this in plain words (see Architecture 4.4), and it is one of the things to agree in H01.

## Where things live

- **Docs:** this folder. Source of truth for design and plan.
- **Code:** `~/Developer/tandem` (git repo, outside the vault). Keep it private; it is not meant for publishing.
- **Server:** Docker container `tandem` on the NAS, port 8790, data in the named volume `tandem_data`.

## Decisions from H01

(Filled in after the conversation: app name, accent colour, check-in day, whether the prompts feel right, whether the server disclosure is acceptable, anything she wants added or removed.)

## Known constraints

- Plain HTTP on the home network means no service worker and no web push on iOS. The home screen icon still works; reminders do not exist in v1.
- Docker is not installed on this Mac. The image is built on the NAS, so the loop's gate tests the app with Node directly and never builds the image.
- On this NAS, docker needs `sudo` and the full path `/usr/local/bin/docker`, and scp is disabled (use tar over ssh). See the Synology NAS handoff note in `Home/`.
