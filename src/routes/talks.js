import { MAX_AGREEMENT_LENGTH, addAgreement, listOpen } from '../core/agreements.js';
import { listUsers } from '../core/auth.js';
import {
  ACTIONS,
  MAX_HOPE_LENGTH,
  MAX_TOPIC_LENGTH,
  TOTAL_STEPS,
  activeTalk,
  applyAction,
  getTalk,
  listTalks,
  proposeTalk,
} from '../core/talks.js';
import { messagePage } from '../views/layout.js';
import { talkPage, talksPage } from '../views/talks.js';

const ID_RE = /^\d{1,9}$/;

const PROPOSE_MESSAGES = {
  blank: 'Write what you would like to talk about first.',
  topic_too_long: `That is too long. Keep it under ${MAX_TOPIC_LENGTH} characters.`,
  hope_too_long: `That is too long. Keep it under ${MAX_HOPE_LENGTH} characters.`,
  talk_active: 'There is a talk going already. Open it from the top of this page.',
};

const AGREEMENT_MESSAGES = {
  blank: 'Write something first.',
  too_long: `That is too long. Keep it under ${MAX_AGREEMENT_LENGTH} characters.`,
  bad_owner: 'Choose who it is for.',
};

const text = (value) => (typeof value === 'string' ? value : '');
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const namesOf = (app) => Object.fromEntries(listUsers(app.db).map((u) => [u.slot, u.displayName]));

function renderList(app, req, extras = {}) {
  const active = activeTalk(app);
  return talksPage({
    user: req.session.user,
    csrf: req.session.csrf,
    active,
    earlier: listTalks(app).filter((t) => t.id !== active?.id),
    maxTopic: MAX_TOPIC_LENGTH,
    maxHope: MAX_HOPE_LENGTH,
    ...extras,
  });
}

// The agreements made in this talk, still open or not.
function agreementsFrom(app, talk) {
  return listOpen(app).filter((g) => g.source === 'talk' && g.sourceId === talk.id);
}

function renderTalk(app, req, talk, form = null) {
  return talkPage({
    user: req.session.user,
    csrf: req.session.csrf,
    talk,
    names: namesOf(app),
    agreements: agreementsFrom(app, talk),
    form: form ?? { error: null, values: { body: '', owner: 'both' } },
    maxAgreement: MAX_AGREEMENT_LENGTH,
  });
}

export function talksRoutes(app) {
  app.get('/talks', async (req, reply) => reply.html(renderList(app, req)));

  app.post('/talks', async (req, reply) => {
    const body = bodyOf(req);
    const result = proposeTalk(app, req.session.user.id, { topic: body.topic, hope: body.hope });
    if (!result.ok) {
      return reply.html(
        renderList(app, req, {
          error: PROPOSE_MESSAGES[result.error] ?? 'That did not work. Try again.',
          values: { topic: text(body.topic), hope: text(body.hope) },
        }),
        400,
      );
    }
    return reply.redirect(`/talks/${result.id}`, 303);
  });

  app.get('/talks/:id', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.callNotFound();
    const talk = getTalk(app, Number(req.params.id));
    if (!talk) return reply.callNotFound();
    return reply.html(renderTalk(app, req, talk));
  });

  // An agreement made in the last step of a talk.
  app.post('/talks/:id/agreement', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.callNotFound();
    const talk = getTalk(app, Number(req.params.id));
    if (!talk) return reply.callNotFound();
    if (talk.state !== 'in_progress' || talk.step !== TOTAL_STEPS) {
      return reply.html(
        messagePage({
          title: 'Not yet',
          text: 'Agreements are added in the last step of a talk.',
          user: req.session.user,
        }),
        403,
      );
    }
    const body = bodyOf(req);
    const result = addAgreement(app, req.session.user.id, {
      body: body.body,
      owner: body.owner,
      source: 'talk',
      sourceId: talk.id,
    });
    if (!result.ok) {
      const form = {
        error: AGREEMENT_MESSAGES[result.error] ?? 'That did not work. Try again.',
        values: { body: text(body.body), owner: text(body.owner) || 'both' },
      };
      return reply.html(renderTalk(app, req, talk, form), 400);
    }
    return reply.redirect(`/talks/${talk.id}`, 303);
  });

  app.post('/talks/:id/:action', async (req, reply) => {
    const { id, action } = req.params;
    if (!ID_RE.test(id) || !ACTIONS.includes(action)) return reply.callNotFound();
    const talkId = Number(id);
    const userId = req.session.user.id;
    const talk = getTalk(app, talkId);
    if (!talk) return reply.callNotFound();

    // A second tap on Next, or a page that was already out of date, must not
    // skip a step: Next only counts if it was pressed on the step now showing.
    const body = bodyOf(req);
    if (action === 'advance' && body.step !== undefined && String(talk.step) !== String(body.step)) {
      return reply.redirect(`/talks/${talkId}`, 303);
    }

    let result = applyAction(app, userId, talkId, action);
    // Finish at step 7 goes through closing straight to closed, so nobody has to press twice.
    if (result.ok && action === 'advance' && result.talk.state === 'closing') {
      result = applyAction(app, userId, talkId, 'finish');
    }

    if (!result.ok && result.error === 'wrong_person') {
      return reply.html(
        messagePage({
          title: 'That one is for the other person',
          text: 'Only the other person can answer this request.',
          user: req.session.user,
        }),
        403,
      );
    }
    // Anything else, such as pressing Start twice, just shows where the talk is now.
    return reply.redirect(`/talks/${talkId}`, 303);
  });
}
