import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { csrfValid, sessionFromCookie } from './core/auth.js';
import { COOKIE_NAME, authRoutes } from './routes/auth.js';
import { homeRoutes } from './routes/home.js';
import { messagePage } from './views/layout.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

// The only routes that work without a session, named by the pattern they were
// registered under (not by the raw URL, so odd URLs cannot sneak in).
const PUBLIC_PATTERNS = new Set(['/healthz', '/signin', '/setup/:token', '/public/*']);

export function buildApp({ db, clock, config }) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('clock', clock);
  app.decorate('config', config);
  app.decorateRequest('session', null);
  app.decorateReply('html', function sendHtml(body, status = 200) {
    return this.code(status).type('text/html; charset=utf-8').send(body);
  });

  app.register(fastifyCookie);
  app.register(fastifyFormbody);
  app.register(fastifyStatic, { root: PUBLIC_DIR, prefix: '/public/', index: false, dotfiles: 'ignore' });

  if (config.log) {
    // Method, path and status only. Never bodies, never query strings.
    app.addHook('onResponse', async (req, reply) => {
      console.log(`${req.method} ${req.url.split('?')[0]} ${reply.statusCode}`);
    });
  }

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'");
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  // The one guard, registered once. Runs after the cookie is parsed and the
  // body is read, before any handler. Order matters: session, public check,
  // sign-in requirement, then CSRF for anything that changes state.
  app.addHook('preHandler', async (req, reply) => {
    req.session = sessionFromCookie(db, clock, req.cookies?.[COOKIE_NAME]);
    if (PUBLIC_PATTERNS.has(req.routeOptions?.url)) return;

    if (!req.session) return reply.redirect('/signin', 303);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const submitted = req.body && typeof req.body === 'object' ? req.body._csrf : undefined;
      if (!csrfValid(req.session, submitted)) {
        return reply.html(
          messagePage({
            title: 'That did not go through',
            text: 'The page was out of date. Go back, reload it and try again.',
            user: req.session.user,
          }),
          403,
        );
      }
    }
  });

  app.get('/healthz', async () => ({ ok: true }));
  authRoutes(app);
  homeRoutes(app);

  return app;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = { ...loadConfig(process.env), log: true };
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(path.join(config.dataDir, 'tandem.sqlite'));
  const clock = { now: () => new Date() };
  const app = buildApp({ db, clock, config });
  await app.listen({ port: config.port, host: '0.0.0.0' });
}
