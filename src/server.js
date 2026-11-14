import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { openDb } from './db.js';

export function buildApp({ db, clock, config }) {
  const app = Fastify({ logger: false });
  app.decorate('db', db);
  app.decorate('clock', clock);
  app.decorate('config', config);

  if (config.log) {
    // Method, path and status only. Never bodies, never query strings.
    app.addHook('onResponse', async (req, reply) => {
      console.log(`${req.method} ${req.url.split('?')[0]} ${reply.statusCode}`);
    });
  }

  app.get('/healthz', async () => ({ ok: true }));

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
