---
date: 2026-11-14
type: project
tags: [project]
---
# Visual Design

## Principle

Calm and plain, like a shared paper notebook. The words the two of you write are the content; the app is the page around them. Nothing counts, flashes, congratulates or nags. The two people are always shown the same way: same size, same colour, in a fixed order (slot `a` left or first, slot `b` right or second) so neither is "the main one".

## Tokens

Custom properties in `public/tokens.css`, with dark values under `@media (prefers-color-scheme: dark)`. No colour value appears anywhere else.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FBF6F3` | `#1A1416` | Page background |
| `--surface` | `#FFFFFF` | `#251D20` | Cards, form fields |
| `--line` | `#EBDDD6` | `#43353A` | Hairlines, field borders |
| `--text` | `#2E2226` | `#F6EDEA` | Primary text |
| `--text-muted` | `#7A6A6C` | `#B3A2A4` | Secondary text, labels |
| `--accent` | `#A64B63` | `#E8A0B2` | The one primary action per screen, links, focus ring |
| `--on-accent` | `#FFFFFF` | `#2E1620` | Label on an accent fill |

Updated 14 Nov 2026 from the Tandem design system (a Claude Design canvas: a warm rose accent on warm neutrals). The accent is still the one thing the two of you may change: change only the two `--accent` values and the two `--on-accent` values, keep `--accent` on `--bg` at a contrast of 4.5 or more and `--on-accent` on `--accent` at 4.5 or more, and keep `public/manifest.webmanifest` (theme and background colour) and the icons in step. Tests check the ratios, the exact palette and the manifest colours.

There is no warning or error colour. Messages use `--text` and plain words.

- **Type:** system font stack. Page title 1.5rem semibold, section heading 1.125rem semibold, body 1rem with line height 1.5, small 0.875rem in `--text-muted`. Text people wrote is always body size, never smaller.
- **Shape:** radius 14px for cards, 10px for buttons and fields. 1px `--line` borders, no shadows.
- **Spacing:** 4px grid. Page gutter 20px. Gap between cards 12px. Maximum content width 560px, centred.
- **Touch targets:** at least 44px high.
- **Motion:** none beyond the browser's defaults.
- **Mark and icon:** two equal rings (radius 26, centres 26 apart, so each ring passes through the other's centre) with the overlap filled, one colour, no gradients: two equal people and the page they share. The app icon is a full-bleed `#A64B63` square (the phone rounds the corners) with the mark in `#FBF6F3`: `icon-180.png` and `icon-512.png`. A dark version, `#E8A0B2` with the mark in `#2E1620`, is `icon-dark-180.png` and `icon-dark-512.png`, used for the browser tab in dark mode. Home opens with the mark beside the name. Never colour the two rings differently, offset one, or add a shadow or gradient.
- **Components:** one accent button per screen. Everything else is an outline button (surface fill, `--line` border, `--text`), a text button (accent, semibold, no border) or a quiet link (14px, `--text-muted`, no border, left aligned). Plain links that act ("Add a moment") are accent, semibold, no underline. Lists of short items (agreements, Looking back) are rows in one card, the text on the left and who it is for on the right, split by hairlines. Fields inside a card sit on `--bg` so they read against the white. The Moments and Ideas tabs are underlined: the current one is semibold with a 2px accent underline.
- Works at 200 percent text size, in both colour schemes, with a visible focus ring, and with JavaScript off.

## Layout

Every signed-in page: the title at the top, content, and a bottom bar with five text links: Home, Check-in, Moments, Agree, Talks ("Agree" is the short label for Agreements and keeps `aria-label="Agreements"`, so the full word fits on a 320px screen and is still read out). The current one is `--text` semibold, the rest `--text-muted`. No icons, no badges, no counts. Ideas live under Moments as a second tab. Sign out and Export sit at the foot of Home in small text.

## Screens

### Home

```
+--------------------------------------+
|  Tandem                              |
|                                      |
|  This week                           |
|  +--------------------------------+  |
|  | Check-in                       |  |
|  | You have not started.          |  |   or "You have a draft." /
|  | [ Open check-in ]              |  |   "You are done. Waiting for both." /
|  +--------------------------------+  |   "Ready to read together."
|                                      |
|  Agreements                          |
|  +--------------------------------+  |
|  | Phones away at dinner    Both  |  |
|  | Book the dentist         Ada   |  |
|  +--------------------------------+  |
|                                      |
|  From the log                        |
|  +--------------------------------+  |
|  | 12 Oct. Walk to the pier, ...  |  |
|  +--------------------------------+  |
|                                      |
|  Add a moment    Add an idea         |
|                                      |
| Home  Check-in  Moments  Agree  Talks|
+--------------------------------------+
```

A talk waiting for an answer shows as a card above Agreements: "Ada would like to talk about: weekends. [ Yes, let's ] [ Not now ]". The proposer sees "You asked to talk about: weekends. Waiting." with a quiet "Withdraw" link.

### Check-in: writing

One card per prompt: the prompt as a label, a text area beneath. The rotating question comes last under the small heading "This week's question". Buttons at the foot: "Save draft" (text button) and "I'm done" (accent). Under them in small text: "Bo cannot see this until you have both finished." After submitting, the same page shows your answers read-only with "You are done. This opens when you have both finished."

### Check-in: reading together

Heading "Read together". First a short "Looking back" list of open agreements. Then one card per prompt, the prompt as heading, the two answers stacked, each under the writer's name, slot `a` first. A blank answer shows as "(left blank)" in muted text. Last, a field "One thing for the week" with an owner choice (name, name, Both) and an "Add" button.

### Check-in: passed

"This one passed." and, if you wrote anything, your own answers. Nothing about the other person.

### Moments

Tabs: Moments, Ideas. Moments: an "Add a moment" form at the top (date, text), then entries by month, each with its date, the text and the writer's name in muted text. Your own entries have quiet "Edit" and "Remove" links. Ideas: an add field, then open ideas with "Done" and, on your own, "Remove"; done ideas listed below in muted text.

### Agreements

Add form (text, owner choice), then the open list. Each row: the text, the owner's name, "Done" and "Drop" as quiet links. A link to "Earlier" for done and dropped ones, which shows the text, the owner and the state word only.

### Talks

List page: a form "Ask to talk" (topic, optional "What I hope for"), and earlier talks as topic and state word. An active talk opens the step screen:

```
+--------------------------------------+
|  Talk: weekends            Step 2/7  |
|                                      |
|  Ada talks. Bo listens.              |
|                                      |
|  Say what is on your mind, from      |
|  your own side. Take your time.      |
|                                      |
|  Timer (optional)   [ Start 3:00 ]   |
|                                      |
|  [ Next ]                            |
|                                      |
|  Pause          End the talk         |
+--------------------------------------+
```

Step copy (names filled in):

| Step | Heading | Body |
|---|---|---|
| 1 | Before you start | One person talks at a time. The listener only listens. Either of you can pause at any point, no reason needed. You are on the same side. |
| 2 | {first} talks. {second} listens. | Say what is on your mind, from your own side. Take your time. |
| 3 | {second} says back what they heard. | Not a reply yet. Only what you heard. {first} says if it is right. |
| 4 | {second} talks. {first} listens. | Say what is on your mind, from your own side. Take your time. |
| 5 | {first} says back what they heard. | Not a reply yet. Only what you heard. {second} says if it is right. |
| 6 | What we each need | Each say one thing you need from here. |
| 7 | Agreements | Write down anything you have both agreed. It is fine to agree on nothing yet. |

Step 7 has the agreement add form and a "Finish" button. Paused screen: "Paused. Come back when you are both ready." with "Resume" and "End the talk". Closed: "Done. Thank you both."

### Sign in and setup

Sign in: a choice of the two names and a passphrase field. Wrong passphrase: "That did not match. Try again." Locked: "Too many tries. Wait ten minutes." Setup: "Choose a passphrase only you know. At least 8 characters."

### Welcome (once per person, three short pages, skippable)

1. "This is a place for the two of you. A weekly check-in, the good moments, help with hard conversations, and the things you agree."
2. "What you write in a check-in stays hidden until you have both finished. Then you read each other's together."
3. "Good to know: this runs on the home server, which Raz looks after. The app keeps your unread answers hidden, but whoever runs a server can technically open its files. If that ever feels wrong, say so."

## Copy rules

- Plain, warm, short. Second person. No exclamation marks.
- Never state or imply that either person is behind, late or has failed to do something. The app does not say who has not submitted.
- No numbers about the relationship: no counts, totals, percentages, streaks or "days since".
- Banned words in the app's own copy (the check script enforces these, case insensitive, whole words): `streak`, `score`, `overdue`, `late`, `failed`, `missed`, `reminder`, `should`, `must`.
- No em dashes anywhere.
- Buttons say what they do: "I'm done", "Add", "Not now", "Yes, let's".
- Errors say what happened and what to do next, in `--text`, with no colour and no icon.
