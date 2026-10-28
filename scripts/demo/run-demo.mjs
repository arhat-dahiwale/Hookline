/**
 * One-command demo (Phase 15). Brings up the FULL topology through nginx,
 * registers endpoints, sends events, shows the live log, replays a delivery,
 * runs the zero-loss chaos step, and shuts everything down:
 *
 *   pnpm demo          (equivalent to: node scripts/demo/run-demo.mjs)
 *
 * Container safety: compose commands run with project name `hookline`
 * (docker-compose.yml) only; the chaos step is scripts/chaos/run-chaos.mjs,
 * which selects victim containers by this project's compose labels.
 * Exit 0 = every demo step passed, including zero lost events.
 */
import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import WebSocket from 'ws';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASE_URL = process.env.HOOKLINE_PUBLIC_URL || 'http://localhost:8080';
const COMPOSE_FILE = resolve(ROOT, 'docker-compose.yml');
// Port-conflict override: another project's container may own host port 3001
// (Grafana); this project must not touch it. The override shifts published
// demo ports (grafana -> 3011) and is documented in README/.env.example.
const COMPOSE_OVERRIDE = resolve(ROOT, 'docker-compose.demo-override.yml');

const say = (...parts) => process.stdout.write(`[demo] ${parts.join(' ')}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function docker(args, { capture = true } = {}) {
  return new Promise((res, rej) => {
    execFile(
      'docker',
      ['compose', '-f', COMPOSE_FILE, '-f', COMPOSE_OVERRIDE, ...args],
      { windowsHide: true, cwd: ROOT, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) rej(new Error(`docker ${args.join(' ')}: ${stderr || err.message}`));
        else res(capture ? stdout : '');
      },
    );
  });
}

/** Raw docker exec against THIS project's postgres container (name fixed by
 * docker-compose.yml). Compose `exec` expects a service name, not this. */
function dockerExec(args) {
  return new Promise((res, rej) => {
    execFile('docker', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) rej(new Error(`docker ${args.join(' ')}: ${stderr || err.message}`));
      else res(stdout);
    });
  });
}

async function waitFor(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(2000);
  }
  throw new Error(`${label} not ready within ${timeoutMs / 1000}s`);
}

class CookieJar {
  #cookies = new Map();
  capture(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      this.#cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  header() {
    return [...this.#cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function api(jar, path, { method = 'GET', body, auth } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(jar?.header() ? { cookie: jar.header() } : {}),
      origin: BASE_URL,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  jar?.capture(res);
  return res;
}

async function main() {
  if (!existsSync(resolve(ROOT, '.env'))) {
    throw new Error('.env missing — copy .env.example and generate secrets (see README)');
  }
  await new Promise((res, rej) =>
    execFile('docker', ['info'], { windowsHide: true }, (err) => (err ? rej(err) : res())),
  );

  say('starting the full topology (3 api, 2 worker) — first run builds images');
  await docker(['up', '-d', '--wait', '--scale', 'api=3', '--scale', 'worker=2'], {
    capture: false,
  });
  await waitFor(`${BASE_URL}/health/ready`, 'nginx/api', 300_000);
  say('topology healthy behind nginx on http://localhost:8080');

  // --- Provision: user, org, API key, one healthy + one failing endpoint ---
  const jar = new CookieJar();
  const email = `demo-${randomUUID()}@example.test`;
  const signUp = await api(jar, '/api/auth/sign-up/email', {
    method: 'POST',
    body: { email, password: 'password-123456', name: 'Demo' },
  });
  if (signUp.status >= 300) throw new Error(`sign-up failed: ${signUp.status}`);
  const org = await api(jar, '/api/auth/organization/create', {
    method: 'POST',
    body: { name: 'Hookline Demo', slug: `demo-${randomUUID().slice(0, 8)}` },
  });
  const organizationId = (await org.json()).id;
  await api(jar, '/api/auth/organization/set-active', {
    method: 'POST',
    body: { organizationId },
  });
  const keyRes = await fetch(`${BASE_URL}/trpc/apiKeys.create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar.header(), origin: BASE_URL },
    body: JSON.stringify({
      name: 'demo',
      scopes: [
        'events:write',
        'events:read',
        'deliveries:read',
        'deliveries:write',
        'endpoints:read',
        'endpoints:write',
      ],
    }),
  });
  const apiKey = (await keyRes.json())?.result?.data?.secret;
  if (!apiKey) throw new Error('apiKeys.create failed');

  const healthyRes = await api(null, '/v1/endpoints', {
    method: 'POST',
    auth: apiKey,
    body: { url: 'http://receiver:9999/hook' },
  });
  const healthy = (await healthyRes.json()).id;
  if (healthyRes.status !== 201)
    throw new Error(`healthy endpoint create failed: ${healthyRes.status}`);
  // The receiver answers 200 on every port it LISTENS on; port 9998 is closed,
  // so deliveries there fail and exercise retry/backoff.
  const failingRes = await api(null, '/v1/endpoints', {
    method: 'POST',
    auth: apiKey,
    body: { url: 'http://receiver:9998/hook' },
  });
  const failing = (await failingRes.json()).id;
  if (failingRes.status !== 201)
    throw new Error(`failing endpoint create failed: ${failingRes.status}`);
  say(`org ready; healthy endpoint ${healthy}, failing endpoint ${failing}`);

  // --- Live log over WebSocket through nginx ---
  const ws = new WebSocket(BASE_URL.replace('http', 'ws') + '/ws', {
    headers: { cookie: jar.header() },
  });
  const liveLines = [];
  await new Promise((res, rej) => {
    ws.once('open', () => {
      ws.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
      res();
    });
    ws.once('error', rej);
    setTimeout(() => rej(new Error('WS did not open')), 15_000);
  });
  ws.on('message', (raw) => {
    const envelope = JSON.parse(String(raw));
    if (envelope.type === 'delivery.created' || envelope.type === 'delivery.status.changed') {
      if (liveLines.length < 6) {
        say(
          `live log: ${envelope.type} ${envelope.deliveryId ?? envelope.id ?? ''} ${envelope.status ?? ''}`.trimEnd(),
        );
      }
      liveLines.push(envelope);
    }
  });

  // --- Send events: healthy fan-out + a failing target ---
  const send = (endpointId) =>
    api(null, '/v1/events', {
      method: 'POST',
      auth: apiKey,
      body: { type: 'demo.checkout', payload: { n: Math.random() }, endpointIds: [endpointId] },
    }).then(async (r) => {
      if (r.status !== 202) throw new Error(`event ingest failed: ${r.status}`);
      const body = await r.json();
      return body.deliveries.map((d) => d.id);
    });
  const healthyDeliveries = [];
  for (let i = 0; i < 5; i += 1) healthyDeliveries.push(...(await send(healthy)));
  await send(failing);
  say('sent 5 events to the healthy endpoint and 1 to the failing one');

  // Healthy deliveries reach the receiver quickly; the failing one retries.
  await sleep(8000);

  // --- Replay a succeeded delivery ---
  const succeededId = healthyDeliveries.find((id) => id !== undefined);
  if (!succeededId) throw new Error('no delivery id captured to replay');
  const detail = await api(null, `/v1/deliveries/${succeededId}`, { auth: apiKey });
  const detailJson = await detail.json();
  if (detailJson.status !== 'succeeded') {
    say(`delivery ${succeededId} is ${detailJson.status}; replay works from terminal states`);
  }
  const replayRes = await api(null, `/v1/deliveries/${succeededId}/replay`, {
    method: 'POST',
    auth: apiKey,
  });
  const replayJson = await replayRes.json();
  if (replayRes.status !== 202) {
    throw new Error(
      `replay failed: ${replayRes.status} ${JSON.stringify(replayJson).slice(0, 200)}`,
    );
  }
  say(`replay queued: ${succeededId} -> ${replayJson.id}`);

  // --- Chaos: kill random api/worker replicas under load, verify zero loss ---
  say('running the chaos step (90s, 2 kills) — same script as Phase 13');
  const chaosExit = await new Promise((res) => {
    const child = spawn(
      process.execPath,
      [resolve(ROOT, 'scripts/chaos/run-chaos.mjs'), '--duration', '90', '--kills', '2'],
      { stdio: 'inherit', cwd: ROOT },
    );
    child.on('exit', res);
  });
  if (chaosExit !== 0) throw new Error(`chaos step failed (exit ${chaosExit})`);

  // --- Summary counts from this project's postgres container ---
  const counts = await dockerExec([
    'exec',
    'hookline-postgres-1',
    'psql',
    '-U',
    'hookline',
    '-d',
    'hookline',
    '-tAc',
    `SELECT (SELECT count(*) FROM events WHERE organization_id = '${organizationId}'), (SELECT count(*) FROM deliveries WHERE organization_id = '${organizationId}'), (SELECT count(*) FROM deliveries WHERE organization_id = '${organizationId}' AND status = 'succeeded')`,
  ]);
  const [events, deliveries, succeeded] = counts.trim().split('|');
  say(`summary: ${events} events, ${deliveries} deliveries, ${succeeded} succeeded (demo org)`);
  say(`live log captured ${liveLines.length} envelopes over the WebSocket`);

  ws.close(1000);
  say('shutting the topology down');
  await docker(['down', '--remove-orphans'], { capture: false });
  say('DONE — dashboard during the run would have shown all of this live');
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    say(`FATAL: ${error.message}`);
    try {
      await docker(['down', '--remove-orphans'], { capture: false });
    } catch {
      // best effort teardown
    }
    process.exit(1);
  });
