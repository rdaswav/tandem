import { homePage } from '../views/home.js';

export function homeRoutes(app) {
  app.get('/', async (req, reply) =>
    reply.html(homePage({ user: req.session.user, csrf: req.session.csrf })),
  );
}
