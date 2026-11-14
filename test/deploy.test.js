import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const script = read('scripts', 'deploy.sh');

// A folder of fake programs that put themselves first on the path. If the
// script under test ever calls one of them, it writes to a log and fails, so
// the tests can prove a dry run never reaches for the network or for Docker.
function fakes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-fakes-'));
  const log = path.join(dir, 'called.log');
  for (const name of ['ssh', 'scp', 'rsync', 'docker', 'sudo', 'curl']) {
    fs.writeFileSync(path.join(dir, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\nexit 99\n`, { mode: 0o755 });
  }
  return { dir, log, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function dryRun(extraEnv = {}, args = ['--dry-run']) {
  const f = fakes();
  try {
    const env = { ...process.env, PATH: `${f.dir}:${process.env.PATH}` };
    for (const key of ['TANDEM_TZ', 'TANDEM_CHECKIN_START_DAY', 'SERVER_OWNER']) delete env[key];
    Object.assign(env, extraEnv);
    const res = spawnSync('bash', [path.join(ROOT, 'scripts', 'deploy.sh'), ...args], { cwd: ROOT, env, encoding: 'utf8' });
    return { ...res, called: fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8') : '' };
  } finally {
    f.cleanup();
  }
}

// ---- the dry run ------------------------------------------------------------

test('--dry-run prints every command, exits 0, and never calls ssh, docker, sudo, curl, scp or rsync', () => {
  const res = dryRun();
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.called, '', `a fake program was called: ${res.called}`);
  for (const expected of [
    '+ ./scripts/verify.sh',
    '+ git archive HEAD | ssh nas',
    'tar xf - -C /volume1/docker/tandem/src',
    'sudo /usr/local/bin/docker build --build-arg COMMIT=',
    '-t tandem .',
    'sudo /usr/local/bin/docker stop tandem',
    'sudo /usr/local/bin/docker rm tandem',
    'sudo /usr/local/bin/docker run -d --name tandem --restart unless-stopped -p 8790:8790 -v tandem_data:/app/data',
    '{{.State.Health.Status}}',
    'nothing was run, nothing was sent, no network was used',
  ]) {
    assert.ok(res.stdout.includes(expected), `missing from the output: ${expected}`);
  }
});

test('the dry run reaches the NAS only as the host alias nas, and shows no address', () => {
  const res = dryRun();
  const hosts = [...res.stdout.matchAll(/ssh (\S+) /g)].map((m) => m[1]);
  assert.ok(hosts.length >= 5);
  assert.deepEqual([...new Set(hosts)], ['nas']);
  assert.equal(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(res.stdout), false, 'no IP address in the output');
});

test('the steps come in the right order', () => {
  const out = dryRun().stdout;
  const at = (s) => out.indexOf(s);
  const order = ['verify.sh', 'git archive HEAD', 'docker build', 'docker stop', 'docker rm', 'docker run', 'State.Health.Status'];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(at(order[i - 1]) > -1 && at(order[i - 1]) < at(order[i]), `${order[i - 1]} comes before ${order[i]}`);
  }
});

test('the volume is kept: the container is replaced but the data volume is never removed', () => {
  const out = dryRun().stdout;
  assert.match(out, /-v tandem_data:\/app\/data/);
  assert.doesNotMatch(out, /volume rm|volume prune|system prune|rm -f|rm -v/);
  assert.match(out, /the data volume is kept/);
});

test('the only thing deleted on the NAS is the copy of the source it is about to replace', () => {
  const deletes = [...dryRun().stdout.matchAll(/rm -rf (\S+)/g)].map((m) => m[1]);
  assert.deepEqual(deletes, ['/volume1/docker/tandem/src']);
});

// ---- the settings -----------------------------------------------------------

test('with no settings the container gets the defaults and no owner name', () => {
  const out = dryRun().stdout;
  assert.match(out, /-e TZ=Australia\/Melbourne -e CHECKIN_START_DAY=0 tandem'/);
  assert.equal(out.includes('SERVER_OWNER'), false);
});

test('SERVER_OWNER, the time zone and the start day are passed to the container when set', () => {
  const out = dryRun({ SERVER_OWNER: 'Cy Dee', TANDEM_TZ: 'Europe/London', TANDEM_CHECKIN_START_DAY: '1' }).stdout;
  assert.ok(out.includes('-e TZ=Europe/London'));
  assert.ok(out.includes('-e CHECKIN_START_DAY=1'));
  assert.ok(out.includes('-e SERVER_OWNER=Cy\\ Dee'), 'a name with a space is escaped for the remote shell');
});

test('settings that could carry a command are refused before anything is printed', () => {
  const bad = [
    { SERVER_OWNER: 'Cy; touch /tmp/x' },
    { SERVER_OWNER: '$(whoami)' },
    { SERVER_OWNER: 'x'.repeat(41) },
    { SERVER_OWNER: 'Cy`id`' },
    { TANDEM_TZ: 'Mars/Base; rm -rf /' },
    { TANDEM_TZ: 'Australia/Melbourne extra' },
    { TANDEM_CHECKIN_START_DAY: '7' },
    { TANDEM_CHECKIN_START_DAY: 'x' },
    { TANDEM_CHECKIN_START_DAY: '1; ls' },
  ];
  for (const env of bad) {
    const res = dryRun(env);
    assert.equal(res.status, 2, JSON.stringify(env));
    assert.equal(res.stdout, '', `${JSON.stringify(env)}: nothing printed`);
    assert.ok(res.stderr.length > 0, `${JSON.stringify(env)}: says why`);
    assert.equal(res.called, '');
  }
});

test('plain names with an apostrophe, a dot or a hyphen are allowed', () => {
  for (const owner of ["Ada O'Neil", 'Mary-Jane', 'J. R.', 'Zoe_2']) {
    const res = dryRun({ SERVER_OWNER: owner });
    assert.equal(res.status, 0, `${owner}: ${res.stderr}`);
    assert.ok(res.stdout.includes('SERVER_OWNER='), owner);
  }
});

test('--help explains the script and exits 0; an unknown option exits 2', () => {
  const help = dryRun({}, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--dry-run/);
  assert.match(help.stdout, /SERVER_OWNER/);
  assert.equal(help.called, '');
  const unknown = dryRun({}, ['--now']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown option/);
});

// ---- the script itself ------------------------------------------------------

test('a real deploy refuses with uncommitted changes and sends only what is committed', () => {
  assert.match(script, /git status --porcelain/);
  assert.match(script, /refusing: there are uncommitted changes/);
  assert.match(script, /git archive HEAD/);
  assert.match(script, /verify\.sh/);
  // The check for uncommitted changes happens before anything is sent.
  assert.ok(script.indexOf('git status --porcelain') < script.indexOf('git archive HEAD | ssh'));
});

test('the script is executable, uses strict mode and has no scp, rsync, address or volume removal', () => {
  assert.ok(fs.statSync(path.join(ROOT, 'scripts', 'deploy.sh')).mode & 0o111, 'executable');
  assert.match(script, /set -euo pipefail/);
  // Look at the code, not the comments that explain why something is not used.
  const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');
  for (const banned of ['scp ', 'rsync', 'volume rm', 'prune', 'docker rm -f', ' -f tandem']) {
    assert.equal(code.includes(banned), false, banned);
  }
  assert.equal(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(script), false, 'no IP address');
});

// ---- the image --------------------------------------------------------------

const dockerfile = read('Dockerfile');

test('the Dockerfile follows Architecture 8', () => {
  assert.match(dockerfile, /^FROM node:24-slim$/m);
  assert.match(dockerfile, /npm ci --omit=dev/);
  assert.match(dockerfile, /^USER node$/m);
  assert.match(dockerfile, /^CMD \["node", "src\/server\.js"\]$/m);
  assert.match(dockerfile, /DATA_DIR=\/app\/data/);
  assert.match(dockerfile, /PORT=8790/);
  assert.match(dockerfile, /^EXPOSE 8790$/m);
  assert.match(dockerfile, /^VOLUME \["\/app\/data"\]$/m);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/healthz/);
});

test('the data folder is made and owned by the user the app runs as, before that user takes over', () => {
  const chown = dockerfile.indexOf('chown -R node:node /app/data');
  assert.ok(chown > -1);
  assert.ok(chown < dockerfile.indexOf('USER node'));
});

test('the image carries what the app needs and nothing it should not', () => {
  const copied = [...dockerfile.matchAll(/^COPY (?!--from)(\S+(?: \S+)*?) \S+$/gm)].flatMap((m) => m[1].split(' '));
  assert.deepEqual(
    copied.sort(),
    ['migrations', 'package-lock.json', 'package.json', 'prompts', 'public', 'scripts/create-users.mjs', 'src'].sort(),
  );
  for (const source of copied) assert.ok(fs.existsSync(path.join(ROOT, source)), `${source} exists`);
  assert.equal(/COPY \. /.test(dockerfile), false, 'no blanket copy of the whole folder');
  assert.doesNotMatch(dockerfile, /passphrase|secret|token|password/i);
});

test('.dockerignore keeps git, dependencies, local data and tests out of the build', () => {
  const ignored = read('.dockerignore').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const entry of ['.git', 'node_modules', 'data', '*.sqlite', '.env', 'test']) {
    assert.ok(ignored.includes(entry), entry);
  }
});

test('the app starts the way the image says, with only the files the image carries', () => {
  // What the Dockerfile copies is enough to import the server: every path the code reads at start up.
  const used = ['src/server.js', 'src/db.js', 'migrations/001_init.sql', 'prompts/prompts.json', 'public/app.css', 'public/tokens.css'];
  const copiedTop = new Set(['src', 'migrations', 'prompts', 'public']);
  for (const file of used) assert.ok(copiedTop.has(file.split('/')[0]), `${file} is inside a copied folder`);
});

// ---- the notes --------------------------------------------------------------

test('server/README.md covers the first deploy, making the people, the home screen, the backup path and SERVER_OWNER', () => {
  const readme = read('server', 'README.md');
  for (const expected of [
    '8790',
    './scripts/deploy.sh --dry-run',
    'create-users.mjs',
    'docker exec tandem',
    'Add to Home Screen',
    '/volume1/@docker/volumes/tandem_data/_data',
    'Hyper Backup',
    'SERVER_OWNER',
    'TANDEM_TZ',
    'TANDEM_CHECKIN_START_DAY',
    'ssh nas',
    'sudo /usr/local/bin/docker',
    '<your nas address>',
    '/healthz',
    'forgotten passphrase',
  ]) {
    assert.ok(readme.includes(expected), expected);
  }
  assert.equal(readme.includes('—'), false, 'no em dash');
  assert.equal(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(readme), false, 'no IP address');
});

test('no LAN address is committed or about to be, anywhere but the npm lock file', () => {
  const res = spawnSync('git', ['grep', '--untracked', '-nE', '192\\.168|10\\.0\\.', '--', '.', ':!package-lock.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(res.status, 1, `found: ${res.stdout}`);
});
