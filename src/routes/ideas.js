import { MAX_IDEA_LENGTH, addIdea, listIdeas, markDone, removeIdea } from '../core/ideas.js';
import { ideasPage } from '../views/ideas.js';
import { messagePage } from '../views/layout.js';

const ID_RE = /^\d{1,9}$/;

const MESSAGES = {
  blank: 'Write something first.',
  too_long: `That is too long. Keep it under ${MAX_IDEA_LENGTH} characters.`,
};

function render(app, req, extras = {}) {
  return ideasPage({
    user: req.session.user,
    csrf: req.session.csrf,
    ideas: listIdeas(app),
    maxLength: MAX_IDEA_LENGTH,
    ...extras,
  });
}

export function ideasRoutes(app) {
  app.get('/ideas', async (req, reply) => reply.html(render(app, req)));

  app.post('/ideas', async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const result = addIdea(app, req.session.user.id, { body: body.body });
    if (!result.ok) {
      const typed = typeof body.body === 'string' ? body.body : '';
      return reply.html(render(app, req, { error: MESSAGES[result.error], addValue: typed }), 400);
    }
    return reply.redirect('/ideas', 303);
  });

  // Either person can mark any open idea done.
  app.post('/ideas/:id/done', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.callNotFound();
    const result = markDone(app, req.session.user.id, Number(req.params.id));
    if (result.error === 'not_found') return reply.callNotFound();
    return reply.redirect('/ideas', 303); // already done is fine too: a double tap changes nothing
  });

  app.post('/ideas/:id/remove', async (req, reply) => {
    if (!ID_RE.test(req.params.id)) return reply.callNotFound();
    const result = removeIdea(app, req.session.user.id, Number(req.params.id));
    if (result.ok) return reply.redirect('/ideas', 303);
    if (result.error === 'not_found') return reply.callNotFound();
    return reply.html(
      messagePage({
        title: 'That one is not yours',
        text: 'You can remove only the ideas you wrote yourself.',
        user: req.session.user,
      }),
      403,
    );
  });
}
