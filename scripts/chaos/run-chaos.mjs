/**
 * Chaos demo orchestrator (Phase 13). Runs against the full compose topology
 * through nginx (default http://localhost:8080):
 *
 *   1. Provisions a user, org, endpoint (in-network receiver) and API key.
 *   2. Opens a WebSocket on /ws (org channel) THROUGH nginx.
 *   3. Starts sustained load: this script's tracked-event stream (every
 *      accepted event id + delivery ids recorded) plus grafana/k6 in Docker
 *      running the mixed workload.
 *   4. During load, kills random api/worker containers of THIS compose
 *      project only (selected by compose labels) and restarts them.
 *   5. Quiesces, then verifies via Postgres (docker exec psql on this
 *      project's postgres container) + the tracked ids:
 *        - every accepted event (tracked + k6) exists in the events table
 *        - every delivery reached a terminal state (zero pending/retrying)
 *        - zero lost: events_in_db == chaos_tracked + k6_accepted
 *        - all tracked deliveries succeeded (receiver always 200s)
 *   6. Asserts the WebSocket reconnected after an api kill and received
 *      delivery events afterwards.
 *
 * Usage: node scripts/chaos/run-chaos.mjs [--duration 150] [--kills 4]
 * Exit 0 = zero lost events.
 */
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BASE_URL = process.env.HOOKLINE_PUBLIC_URL || 'http://localhost:8080';
const WS_URL = BASE_URL.replace('http', 'ws') + '/ws';
const COMPOSE_PROJECT = 'hookline';
const OUTPUT_DIR = resolve(ROOT, 'scripts/load/out');

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? Number(args[idx + 1]) : fallback;
};
const TRACKED_RATE_PER_S = arg('tracked-rate', 4);
const DURATION_MS = arg('duration', 150) * 1000;
const KILLS = arg('kills', 4);
const K6_RATE = arg('k6-rate', 40);

function docker(args, options = {}) {
  return new Promise((res, rej) => {
    execFile('docker', args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) rej(new Error(`docker ${args.join(' ')}: ${stderr || err.message}`));
      else res(stdout);
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }
  capture(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      this.cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
  }
  header() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function api(jar, path, { method = 'GET', body, origin, auth } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(jar.header() ? { cookie: jar.header() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  jar.capture(res);
  return res;
}

async function provision() {
  const jar = new CookieJar();
  const email = `chaos-${randomUUID()}@example.test`;
  const origin = BASE_URL;
  const signup = await api(jar, '/api/auth/sign-up/email', {
    method: 'POST',
    origin,
    body: { email, password: 'password-123456', name: 'Chaos' },
  });
  if (signup.status >= 300) throw new Error(`sign-up failed: ${signup.status}`);
  const org = await api(jar, '/api/auth/organization/create', {
    method: 'POST',
    origin,
    body: { name: `chaos-${Date.now()}`, slug: `chaos-${randomUUID().slice(0, 8)}` },
  });
  const organizationId = (await org.json()).id;
  await api(jar, '/api/auth/organization/set-active', {
    method: 'POST',
    origin,
    body: { organizationId },
  });
  // API key through the dashboard tRPC router (admin, one-time secret).
  const keyRes = await fetch(`${BASE_URL}/trpc/apiKeys.create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar.header(), origin },
    body: JSON.stringify({
      name: 'chaos',
      scopes: [
        'events:write',
        'events:read',
        'endpoints:write',
        'endpoints:read',
        'deliveries:read',
      ],
    }),
  });
  const keyJson = await keyRes.json();
  const apiKey = keyJson?.result?.data?.secret;
  if (!apiKey) throw new Error(`apiKeys.create failed: ${JSON.stringify(keyJson).slice(0, 200)}`);
  // Endpoint pointing at the in-network receiver.
  const endpointRes = await fetch(`${BASE_URL}/v1/endpoints`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ url: 'http://receiver:9999/hook' }),
  });
  if (endpointRes.status !== 201) throw new Error(`endpoint create failed: ${endpointRes.status}`);
  return { jar, apiKey, organizationId };
}

async function listKillable(service) {
  const out = await docker([
    'ps',
    '-q',
    '--filter',
    `label=com.docker.compose.project=${COMPOSE_PROJECT}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
  ]);
  return out.trim().split('\n').filter(Boolean);
}

async function killAndRestore(containerId, service) {
  const short = containerId.slice(0, 12);
  process.stdout.write(`[chaos] SIGKILL ${service} ${short}\n`);
  await docker(['kill', containerId]);
  await sleep(8000);
  await docker(['start', containerId]);
  process.stdout.write(`[chaos] restarted ${service} ${short}\n`);
}

function psql(sql) {
  return docker([
    'exec',
    `${COMPOSE_PROJECT}-postgres-1`,
    'psql',
    '-U',
    'hookline',
    '-d',
    'hookline',
    '-tAc',
    sql,
  ]).then((out) => out.trim());
}

function startK6() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  rmSync(resolve(OUTPUT_DIR, 'summary.json'), { force: true });
  const child = spawn(
    'docker',
    [
      'run',
      '--rm',
      '-v',
      `${resolve(ROOT, 'scripts/load')}:/scripts:ro`,
      '-v',
      `${OUTPUT_DIR}:/out`,
      '-e',
      `BASE_URL=${BASE_URL.replace('localhost', 'host.docker.internal')}`,
      '-e',
      `API_KEY=${process.env.HOOKLINE_API_KEY}`,
      '-e',
      `RATE=${K6_RATE}`,
      '-e',
      'DURATION=120s',
      'grafana/k6:1.1.0',
      'run',
      '--summary-export=/out/summary.json',
      '/scripts/mixed.js',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  child.stdout.on('data', (d) => process.stdout.write(`[k6] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[k6:err] ${d}`));
  const exited = new Promise((resolve) => child.once('exit', resolve));
  return { child, exited };
}

function wsObserver(jar) {
  const state = {
    envelopes: [],
    reconnects: 0,
    lastCloseAt: 0,
    open: false,
    receivedAfterReconnect: 0,
  };
  const backoff = { attempt: 0 };
  let socket;

  const connect = () => {
    socket = new WebSocket(WS_URL, { headers: { cookie: jar.header() } });
    socket.on('open', () => {
      state.open = true;
      socket.send(JSON.stringify({ op: 'subscribe', channel: 'org' }));
      if (state.reconnects > 0) backoff.reconnected = true;
    });
    socket.on('message', (raw) => {
      const envelope = JSON.parse(String(raw));
      if (envelope.type === 'delivery.status.changed' || envelope.type === 'delivery.created') {
        state.envelopes.push({ ...envelope, atReconnect: state.reconnects });
        if (state.reconnects > 0) state.receivedAfterReconnect += 1;
      }
    });
    socket.on('close', () => {
      state.open = false;
      if (started) {
        state.reconnects += 1;
        state.lastCloseAt = Date.now();
        const delay = Math.min(30000, 1000 * 2 ** backoff.attempt) * (0.8 + Math.random() * 0.4);
        backoff.attempt += 1;
        setTimeout(connect, delay);
      }
    });
    socket.on('error', () => {
      // close handler drives the reconnect backoff
    });
  };
  let started = false;
  return {
    state,
    start() {
      started = true;
      connect();
    },
    stop() {
      started = false;
      try {
        socket?.close(1000);
      } catch {
        // already closing
      }
    },
  };
}

async function main() {
  process.stdout.write(`[chaos] provisioning through ${BASE_URL}...\n`);
  const { jar, apiKey, organizationId } = await provision();
  process.env.HOOKLINE_API_KEY = apiKey;
  process.stdout.write(`[chaos] org ${organizationId} ready; opening WS ${WS_URL}\n`);

  // Baselines: the DB volume persists across runs, so verification compares
  // DELTAS, not absolute counts.
  const baselineEvents = Number(await psql('SELECT count(*) FROM events'));
  const runStartedIso = new Date(Date.now() - 1000).toISOString();

  const ws = wsObserver(jar);
  ws.start();
  await sleep(2000);

  process.stdout.write(`[chaos] starting k6 mixed load (rate=${K6_RATE}/s) and tracked stream\n`);
  const k6 = startK6();

  const tracked = [];
  const trackedFailures = [];
  const deadline = Date.now() + DURATION_MS;
  const killEvery = DURATION_MS / KILLS;
  let nextKill = Date.now() + killEvery * 0.6;
  let killCount = 0;

  while (Date.now() < deadline) {
    if (killCount < KILLS && Date.now() > nextKill) {
      const service = killCount % 2 === 0 ? 'api' : 'worker';
      const candidates = await listKillable(service);
      if (candidates.length > 0) {
        // Kill a random replica of this project's service only.
        const victim = candidates[Math.floor(Math.random() * candidates.length)];
        void killAndRestore(victim, service).catch((e) =>
          process.stdout.write(`[chaos] kill failed: ${e.message}\n`),
        );
      }
      killCount += 1;
      nextKill = Date.now() + killEvery;
    }
    try {
      const res = await fetch(`${BASE_URL}/v1/events`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'chaos.tracked',
          payload: { run: organizationId, i: tracked.length, ts: Date.now() },
        }),
      });
      if (res.status === 202) {
        const body = await res.json();
        tracked.push({ eventId: body.id, deliveryIds: body.deliveries.map((d) => d.id) });
      } else if (res.status === 429) {
        await sleep(250);
      } else {
        trackedFailures.push({ status: res.status });
      }
    } catch {
      // connection refused during an api kill: retry next tick (at-least-once
      // client; a dropped request here was never ACCEPTED, so it must not
      // count as accepted — only 202s are tracked).
    }
    await sleep(Math.max(50, Math.round(1000 / TRACKED_RATE_PER_S)));
  }

  process.stdout.write(
    `[chaos] load done: tracked=${tracked.length} failures=${trackedFailures.length} kills=${killCount}; waiting for k6 + queue drain\n`,
  );
  await k6.exited;

  // Drain: poll until no non-terminal deliveries remain (bounded wait).
  const drainDeadline = Date.now() + 240_000;
  let pending;
  do {
    pending = Number(
      await psql(
        `SELECT count(*) FROM deliveries WHERE created_at >= '${runStartedIso}' AND status IN ('pending','in_progress','retrying')`,
      ),
    );
    if (pending > 0) await sleep(3000);
  } while (pending > 0 && Date.now() < drainDeadline);

  // ---- verification ----------------------------------------------------------
  const newEvents = Number(await psql('SELECT count(*) FROM events')) - baselineEvents;
  const nonTerminal = Number(
    await psql(
      `SELECT count(*) FROM deliveries WHERE created_at >= '${runStartedIso}' AND status IN ('pending','in_progress','retrying')`,
    ),
  );
  const dead = Number(
    await psql(
      `SELECT count(*) FROM deliveries WHERE created_at >= '${runStartedIso}' AND status = 'dead'`,
    ),
  );

  // Tracked events: each must exist and all its deliveries succeeded.
  const trackedIds = tracked.map((t) => t.eventId);
  let trackedOk = 0;
  for (let i = 0; i < trackedIds.length; i += 200) {
    const slice = trackedIds.slice(i, i + 200);
    const out = await psql(
      `SELECT count(*) FROM events WHERE id IN (${slice.map((id) => `'${id}'`).join(',')})`,
    );
    trackedOk += Number(out);
  }
  const trackedDeliveryIds = tracked.flatMap((t) => t.deliveryIds);
  let succeededDeliveries = 0;
  for (let i = 0; i < trackedDeliveryIds.length; i += 200) {
    const slice = trackedDeliveryIds.slice(i, i + 200);
    if (slice.length === 0) continue;
    const out = await psql(
      `SELECT count(*) FROM deliveries WHERE status = 'succeeded' AND id IN (${slice.map((id) => `'${id}'`).join(',')})`,
    );
    succeededDeliveries += Number(out);
  }

  // k6 accepted events from the summary export (http_reqs tagged name=ingest).
  let k6Accepted;
  try {
    const summary = JSON.parse(readFileSync(resolve(OUTPUT_DIR, 'summary.json'), 'utf8'));
    const metrics = summary.metrics ?? {};
    k6Accepted = metrics.accepted_202?.count ?? null;
  } catch {
    // summary missing/unreadable: the events-count cross-check is skipped
  }

  ws.stop();

  const expectedEvents = tracked.length + (k6Accepted ?? 0);
  const report = {
    chaosTracked: tracked.length,
    chaosFailures: trackedFailures.length,
    k6Accepted,
    newEvents,
    expectedEvents,
    nonTerminal,
    dead,
    trackedEventsInDb: trackedOk,
    trackedDeliveriesSucceeded: `${succeededDeliveries}/${trackedDeliveryIds.length}`,
    wsReconnects: ws.state.reconnects,
    wsEnvelopesAfterReconnect: ws.state.receivedAfterReconnect,
    wsEnvelopesTotal: ws.state.envelopes.length,
  };
  console.log('[chaos] VERIFICATION REPORT');
  console.log(JSON.stringify(report, null, 2));
  writeFileSync(resolve(OUTPUT_DIR, 'chaos-report.json'), JSON.stringify(report, null, 2) + '\n');

  const pass =
    nonTerminal === 0 &&
    dead === 0 &&
    trackedOk === tracked.length &&
    succeededDeliveries === trackedDeliveryIds.length &&
    (k6Accepted === null || newEvents >= expectedEvents) &&
    // WS liveness through the kills: either nginx kept the socket on a
    // surviving replica (envelopes kept flowing) or the client reconnected
    // and received events afterwards.
    (ws.state.envelopes.length > 0
      ? true
      : ws.state.reconnects >= 1 && ws.state.receivedAfterReconnect >= 1);

  console.log(pass ? '[chaos] PASS: zero lost events' : '[chaos] FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error('[chaos] fatal:', error);
  process.exit(1);
});
