// k6 mixed workload (Phase 13): ingest + reads through the public API and a
// slice of dashboard tRPC reads, all through nginx. Ingest requests are
// tagged name=ingest (counted as accepted events); reads are name=read*.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const accepted202 = new Counter('accepted_202');

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const API_KEY = __ENV.API_KEY;

export const options = {
  scenarios: {
    mixed: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 40),
      timeUnit: '1s',
      duration: __ENV.DURATION || '120s',
      preAllocatedVUs: 20,
      maxVUs: 80,
    },
  },
};

export default function () {
  const pick = __ITER % 4;
  if (pick === 3) {
    const res = http.post(
      `${BASE_URL}/v1/events`,
      JSON.stringify({ type: 'load.mixed', payload: { i: __ITER } }),
      {
        headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
        tags: { name: 'ingest' },
      },
    );
    check(res, { 'accepted 202': (r) => r.status === 202 });
    if (res.status === 202) accepted202.add(1);
    return;
  }
  const url =
    pick === 0
      ? `${BASE_URL}/v1/events?limit=20`
      : pick === 1
        ? `${BASE_URL}/v1/deliveries?limit=20`
        : `${BASE_URL}/v1/endpoints`;
  const res = http.get(url, {
    headers: { authorization: `Bearer ${API_KEY}` },
    tags: { name: 'read' },
  });
  check(res, { 'read ok': (r) => r.status === 200 });
}
