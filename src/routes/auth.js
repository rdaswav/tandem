import {
  completeSetup,
  createSession,
  listUsers,
  markWelcomed,
  signIn,
  signOut,
  SESSION_DAYS,
} from '../core/auth.js';
import { setupPage, signInPage } from '../views/auth.js';
import { WELCOME_PAGES, welcomePage } from '../views/welcome.js';

export const COOKIE_NAME = 'tandem_session';

function setSessionCookie(reply, session) {
  // No Secure flag: the app runs on plain HTTP on the home network.
  reply.setCookie(COOKIE_NAME, session.cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
}

const SIGN_IN_ERRORS = {
  invalid: 'That did not match. Try again.',
  locked: 'Too many tries. Wait ten minutes.',
};

const SETUP_ERRORS = {
  mismatch: 'The two did not match. Try again.',
  passphrase_too_short: 'That is too short. Use at least 8 characters.',
  invalid_token: 'This link has already been used or is not valid. Ask for a new one.',
};

export function authRoutes(app) {
  const readyUsers = () => listUsers(app.db).filter((u) => u.ready);

  // Who looks after the server, for the third welcome page: the SERVER_OWNER
  // setting if there is one, otherwise the first person.
  const serverOwner = () =>
    app.config.serverOwner || listUsers(app.db).find((u) => u.slot === 'a')?.displayName || 'someone at home';

  app.get('/signin', async (req, reply) => {
    if (req.session) return reply.redirect('/', 303);
    return reply.html(signInPage({ users: readyUsers() }));
  });

  app.post('/signin', async (req, reply) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const users = readyUsers();
    // Only a plain value can name a person; anything else names nobody.
    const picked = typeof body.user === 'string' || typeof body.user === 'number' ? String(body.user) : null;
    const chosen = users.find((u) => String(u.id) === picked);
    const result = chosen
      ? signIn(app.db, app.clock, chosen.id, body.passphrase)
      : { ok: false, error: 'invalid' };

    if (!result.ok) {
      if (result.error === 'locked') reply.header('Retry-After', '600');
      return reply.html(
        signInPage({ users, error: SIGN_IN_ERRORS[result.error], selectedId: chosen?.id ?? null }),
        result.error === 'locked' ? 429 : 401,
      );
    }
    setSessionCookie(reply, result.session);
    // Someone who has not been welcomed yet is welcomed first, once.
    return reply.redirect(result.user.welcomedAt ? '/' : '/welcome', 303);
  });

  app.post('/signout', async (req, reply) => {
    signOut(app.db, req.cookies?.[COOKIE_NAME]);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.redirect('/signin', 303);
  });

  app.get('/setup/:token', async (req, reply) => reply.html(setupPage({ token: req.params.token })));

  app.post('/setup/:token', async (req, reply) => {
    const { token } = req.params;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const fail = (key) => reply.html(setupPage({ token, error: SETUP_ERRORS[key] }), 400);

    if (typeof body.passphrase !== 'string' || body.passphrase !== body.confirm) return fail('mismatch');
    const result = completeSetup(app.db, app.clock, token, body.passphrase);
    if (!result.ok) return fail(result.error);

    setSessionCookie(reply, createSession(app.db, app.clock, result.user.id));
    return reply.redirect('/welcome', 303); // a brand-new person has not been welcomed
  });

  app.get('/welcome', async (req, reply) => {
    const asked = Number(req.query?.page);
    const n = Number.isInteger(asked) && asked >= 1 && asked <= WELCOME_PAGES ? asked : 1;
    return reply.html(welcomePage({ csrf: req.session.csrf, n, serverOwner: serverOwner() }));
  });

  // Skip or finish: either way this person has been welcomed, and it is saved once.
  app.post('/welcome/done', async (req, reply) => {
    markWelcomed(app.db, app.clock, req.session.user.id);
    return reply.redirect('/', 303);
  });
}
