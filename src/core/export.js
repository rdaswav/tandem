// A person's export: everything they are allowed to see, as one plain object.
// Check-in answers come only through answersVisibleTo, so the other person's
// unrevealed answers can never be in it. Nothing here reads passphrases,
// sessions, tokens or any other secret. Building it changes nothing.
//
// Takes ctx first: an object with db, clock and config.

import { listOpen, listEarlier } from './agreements.js';
import { listUsers } from './auth.js';
import { listIdeas } from './ideas.js';
import { listMoments } from './moments.js';
import { promptText } from './prompts.js';
import { answersVisibleTo, roundByWeek, stateFor } from './rounds.js';
import { listTalks } from './talks.js';
import { localDate } from './week.js';

export const EXPORT_VERSION = 1;

// A round is included when this person has something to see in it: it opened
// for both, or they wrote in it themselves. A round only the other person
// opened is not included, so the file says nothing about what they did.
function checkins(ctx, userId, names) {
  const weeks = ctx.db.prepare('SELECT week_start FROM rounds ORDER BY week_start DESC').all();
  const out = [];
  for (const { week_start: weekStart } of weeks) {
    const round = roundByWeek(ctx, weekStart);
    const rows = answersVisibleTo(ctx, round.id, userId);
    if (!round.revealedAt && rows.length === 0) continue;
    out.push({
      weekStart: round.weekStart,
      state: stateFor(ctx, round, userId),
      answers: rows.map((r) => ({
        person: names[r.slot],
        promptId: r.promptId,
        prompt: promptText(r.promptId),
        text: r.body,
      })),
    });
  }
  return out;
}

export function buildExport(ctx, userId) {
  const users = listUsers(ctx.db);
  const names = Object.fromEntries(users.map((u) => [u.slot, u.displayName]));
  const me = users.find((u) => u.id === userId);
  const nameOf = (slot) => names[slot];

  const ideas = listIdeas(ctx);
  return {
    app: 'Tandem',
    version: EXPORT_VERSION,
    exportedAt: ctx.clock.now().toISOString(),
    exportedBy: me ? me.displayName : null,
    people: [names.a, names.b],
    checkins: checkins(ctx, userId, names),
    moments: listMoments(ctx).map((m) => ({
      date: m.happenedOn,
      person: m.authorName,
      text: m.body,
    })),
    ideas: [
      ...ideas.open.map((i) => ({ person: i.authorName, text: i.body, state: 'open' })),
      ...ideas.done.map((i) => ({ person: i.authorName, text: i.body, state: 'done' })),
    ],
    agreements: [...listOpen(ctx), ...listEarlier(ctx)].map((g) => ({
      text: g.body,
      forPerson: g.owner === 'both' ? 'Both' : nameOf(g.owner),
      state: g.state,
    })),
    talks: listTalks(ctx).map((t) => ({
      topic: t.topic,
      hope: t.hope,
      askedBy: t.proposerName,
      state: t.state,
    })),
  };
}

// The file name for a download, with the local date.
export function exportFileName(ctx) {
  return `tandem-export-${localDate(ctx.clock.now(), ctx.config.tz)}.json`;
}
