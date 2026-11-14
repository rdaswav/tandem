import { listUsers } from '../core/auth.js';
import { promptText } from '../core/prompts.js';
import {
  MAX_ANSWER_LENGTH,
  answersVisibleTo,
  currentRound,
  pastRounds,
  promptsFor,
  saveDraft,
  stateFor,
  submit,
} from '../core/rounds.js';
import { passedPage, pastListPage, revealedPage, waitingPage, writingPage } from '../views/checkin.js';

const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;

const MESSAGES = {
  too_long: `That answer is too long. Keep each one under ${MAX_ANSWER_LENGTH} characters.`,
  no_answers: 'Write at least one answer first, then press I\'m done.',
};

// Who is looking, and the names to show.
function viewer(app, req) {
  const user = req.session.user;
  const users = listUsers(app.db);
  return {
    user,
    csrf: req.session.csrf,
    names: Object.fromEntries(users.map((u) => [u.slot, u.displayName])),
    otherName: users.find((u) => u.id !== user.id)?.displayName ?? 'The other person',
  };
}

// The round's prompts, plus any stored prompt id that has since left the
// pack, which then shows under its id.
function promptsShown(round, rows) {
  const prompts = promptsFor(round);
  const known = new Set(prompts.map((p) => p.id));
  const extra = [...new Set(rows.map((r) => r.promptId))]
    .filter((id) => !known.has(id))
    .map((id) => ({ id, text: promptText(id), rotating: false }));
  return [...prompts, ...extra];
}

// Only prompts this round actually asks are taken from a submitted form.
function answersFromBody(round, body) {
  const answers = {};
  if (!body || typeof body !== 'object') return answers;
  for (const p of promptsFor(round)) {
    if (typeof body[p.id] === 'string') answers[p.id] = body[p.id];
  }
  return answers;
}

// This week's page, whatever state the viewer is in.
function renderCurrent(app, req, { values = null, error = null } = {}) {
  const v = viewer(app, req);
  const round = currentRound(app);
  const state = stateFor(app, round, v.user.id);
  const rows = answersVisibleTo(app, round.id, v.user.id);
  const prompts = promptsShown(round, rows);
  const own = rows.filter((r) => r.userId === v.user.id);

  if (state === 'revealed') return revealedPage({ user: v.user, prompts, rows, names: v.names });
  if (state === 'passed') return passedPage({ user: v.user, prompts, own });
  if (state === 'waiting') return waitingPage({ user: v.user, prompts, own });

  const saved = Object.fromEntries(own.map((r) => [r.promptId, r.body]));
  return writingPage({
    user: v.user,
    csrf: v.csrf,
    otherName: v.otherName,
    prompts: promptsFor(round),
    values: values ?? saved,
    error,
    maxLength: MAX_ANSWER_LENGTH,
  });
}

export function checkinRoutes(app) {
  app.get('/checkin', async (req, reply) => reply.html(renderCurrent(app, req)));

  app.post('/checkin/save', async (req, reply) => {
    const round = currentRound(app);
    const answers = answersFromBody(round, req.body);
    const result = saveDraft(app, round.id, req.session.user.id, answers);
    if (!result.ok && result.error === 'too_long') {
      return reply.html(renderCurrent(app, req, { values: answers, error: MESSAGES.too_long }), 400);
    }
    return reply.redirect('/checkin', 303);
  });

  // Saves what is on the page, then locks it in. If this is the second person
  // to finish, the round opens for both.
  app.post('/checkin/submit', async (req, reply) => {
    const round = currentRound(app);
    const userId = req.session.user.id;
    const answers = answersFromBody(round, req.body);
    const saved = saveDraft(app, round.id, userId, answers);
    if (!saved.ok && saved.error === 'too_long') {
      return reply.html(renderCurrent(app, req, { values: answers, error: MESSAGES.too_long }), 400);
    }
    if (saved.ok) {
      const result = submit(app, round.id, userId);
      if (!result.ok && result.error === 'no_answers') {
        return reply.html(renderCurrent(app, req, { values: answers, error: MESSAGES.no_answers }), 400);
      }
    }
    return reply.redirect('/checkin', 303);
  });

  app.get('/checkin/past', async (req, reply) => {
    const v = viewer(app, req);
    return reply.html(pastListPage({ user: v.user, rounds: pastRounds(app, v.user.id) }));
  });

  // An earlier week. Only weeks that appear in this person's own past list
  // exist as far as they are concerned; anything else is a plain 404, the same
  // as a week that was never opened.
  app.get('/checkin/:weekStart', async (req, reply) => {
    const { weekStart } = req.params;
    if (!WEEK_RE.test(weekStart)) return reply.callNotFound();
    if (weekStart === currentRound(app).weekStart) return reply.redirect('/checkin', 303);

    const v = viewer(app, req);
    const round = pastRounds(app, v.user.id).find((r) => r.weekStart === weekStart);
    if (!round) return reply.callNotFound();

    const rows = answersVisibleTo(app, round.id, v.user.id);
    const prompts = promptsShown(round, rows);
    if (round.state === 'revealed') {
      return reply.html(revealedPage({ user: v.user, prompts, rows, names: v.names, weekStart, isPast: true }));
    }
    const own = rows.filter((r) => r.userId === v.user.id);
    return reply.html(passedPage({ user: v.user, prompts, own, weekStart, isPast: true }));
  });
}
