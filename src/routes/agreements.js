import { listUsers } from '../core/auth.js';
import {
  MAX_AGREEMENT_LENGTH,
  addAgreement,
  dropAgreement,
  listEarlier,
  listOpen,
  markAgreementDone,
} from '../core/agreements.js';
import { agreementsPage, earlierPage } from '../views/agreements.js';

const ID_RE = /^\d{1,9}$/;

const MESSAGES = {
  blank: 'Write something first.',
  too_long: `That is too long. Keep it under ${MAX_AGREEMENT_LENGTH} characters.`,
  bad_owner: 'Choose who it is for.',
};

const text = (value) => (typeof value === 'string' ? value : '');

function render(app, req, extras = {}) {
  const names = Object.fromEntries(listUsers(app.db).map((u) => [u.slot, u.displayName]));
  return agreementsPage({
    user: req.session.user,
    csrf: req.session.csrf,
    agreements: listOpen(app),
    names,
    maxLength: MAX_AGREEMENT_LENGTH,
    ...extras,
  });
}

export function agreementsRoutes(app) {
  app.get('/agreements', async (req, reply) => reply.html(render(app, req)));

  app.get('/agreements/earlier', async (req, reply) =>
    reply.html(earlierPage({ user: req.session.user, agreements: listEarlier(app) })),
  );

  app.post('/agreements', async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = addAgreement(app, req.session.user.id, {
      body: body.body,
      owner: body.owner,
      source: 'direct',
    });
    if (!result.ok) {
      return reply.html(
        render(app, req, {
          error: MESSAGES[result.error] ?? 'That did not work. Try again.',
          addValues: { body: text(body.body), owner: text(body.owner) || 'both' },
        }),
        400,
      );
    }
    return reply.redirect('/agreements', 303);
  });

  // Either person can close any agreement. Closing one that is already closed is harmless.
  for (const [action, close] of [['done', markAgreementDone], ['drop', dropAgreement]]) {
    app.post(`/agreements/:id/${action}`, async (req, reply) => {
      if (!ID_RE.test(req.params.id)) return reply.callNotFound();
      const result = close(app, req.session.user.id, Number(req.params.id));
      if (result.error === 'not_found') return reply.callNotFound();
      return reply.redirect('/agreements', 303);
    });
  }
}
