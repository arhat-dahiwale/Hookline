// k6 ingestion load (Phase 13). Run via the grafana/k6 image:
//   docker run --rm -v <repo>/scripts/load:/scripts -e BASE_URL=... -e API_KEY=... \
//     grafana/k6:1.1.0 run --summary-export=/out/summary.json /scripts/ingest.js
// Counting: every request is tagged name=ingest so the summary export's
// http_reqs{name:ingest}.count is the number of accepted events.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const accepted202 = new Counter('accepted_202');

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:8080';
const API_KEY = __ENV.API_KEY;

export const options = {
  scenarios: {
    ingest: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.RATE || 30),
      timeUnit: '1s',
      duration: __ENV.DURATION || '90s',
      preAllocatedVUs: 20,
      maxVUs: 60,
    },
  },
  thresholds: {
    // Ingestion is async (202): the p95 should stay well under a second.
    'http_req_duration{name:ingest}': ['p(95)<1000'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/v1/events`,
    JSON.stringify({
      type: 'load.ingest',
      payload: { source: 'k6', ts: Date.now(), n: __ITER },
    }),
    {
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      tags: { name: 'ingest' },
    },
  );
  check(res, { 'accepted 202': (r) => r.status === 202 });
  if (res.status === 202) accepted202.add(1);
}
