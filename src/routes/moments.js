import {
  MAX_MOMENT_LENGTH,
  addMoment,
  editMoment,
  listMoments,
  removeMoment,
  todayFor,
} from '../core/moments.js';
import { messagePage } from '../views/layout.js';
import { momentsPage } from '../views/moments.js';

const ID_RE = /^\d{1,9}$/;

const MESSAGES = {
  blank: 'Write something first.',
  too_long: `That is too long. Keep it under ${MAX_MOMENT_LENGTH} characters.`,
  bad_date: 'That date did not look right. Try again.',
  future_date: 'That date is still ahead. Pick today or earlier.',
};

const text = (value) => (typeof value === 'string' ? value : '');
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

function render(app, req, extras = {}) {
  return momentsPage({
    user: req.session.user,
    csrf: req.session.csrf,
    today: todayFor(app),
    moments: listMoments(app),
    maxLength: MAX_MOMENT_LENGTH,
    ...extras,
  });
}

export function momentsRoutes(app) {
  app.get('/moments', async (req, reply) => reply.html(render(app, req)));

  app.post('/moments', async (req, reply) => {
    const body = bodyOf(req);
    const result = addMoment(app, req.session.user.id, { happenedOn: body.happened_on, body: body.body });
    if (!result.ok) {
      return reply.html(
        render(app, req, {
          error: MESSAGES[result.error],
          addValues: { happenedOn: text(body.happened_on), body: text(body.body) },
        }),
        400,
      );
    }
    return reply.redirect('/moments', 303);
  });

  app.post('/moments/:id/edit', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.callNotFound();
    const id = Number(req.params.id);
    const body = bodyOf(req);
    const result = editMoment(app, req.session.user.id, id, { happenedOn: body.happened_on, body: body.body });
    if (result.ok) return reply.redirect('/moments', 303);
    if (result.error === 'not_found') return reply.callNotFound();
    if (result.error === 'not_author') return notYours(reply, req);
    return reply.html(
      render(app, req, {
        error: MESSAGES[result.error],
        editing: { id, values: { happenedOn: text(body.happened_on), body: text(body.body) } },
      }),
      400,
    );
  });

  app.post('/moments/:id/remove', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.callNotFound();
    const result = removeMoment(app, req.session.user.id, Number(req.params.id));
    if (result.ok) return reply.redirect('/moments', 303);
    if (result.error === 'not_found') return reply.callNotFound();
    return notYours(reply, req);
  });
}

function notYours(reply, req) {
  return reply.html(
    messagePage({
      title: 'That one is not yours',
      text: 'You can change only the moments you wrote yourself.',
      user: req.session.user,
    }),
    403,
  );
}
