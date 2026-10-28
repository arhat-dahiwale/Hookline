// One-off check that the API.md verification samples (Node and Python) accept
// a signature produced by the REAL delivery-engine signing module, and reject
// tampered payloads. Run from the repo root: node scripts/check-samples.mjs
// (scratch tooling for the Phase 15 docs task; safe to delete).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Import the production signing code from the built server dist.
const dist = resolve('apps/server/dist/modules/delivery-engine/signing.js');
const { signPayload } = await import(`file://${dist.replaceAll('\\', '/')}`);

const secret = 'whsec_sample_check_secret';
const timestamp = Math.floor(Date.now() / 1000);
const rawBody = JSON.stringify({
  id: 'evt_01JDEMOSAMPLE',
  type: 'invoice.paid',
  createdAt: new Date().toISOString(),
  data: { invoiceId: 'inv_123', amount: 4900 },
});
const headers = {
  'hookline-timestamp': String(timestamp),
  'hookline-signature': signPayload(secret, timestamp, rawBody),
};

// --- Node sample (verbatim logic from API.md) ---
import crypto from 'node:crypto';
function verify(rawBody, headers, secret, toleranceSec = 300) {
  const ts = headers['hookline-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  return (headers['hookline-signature'] ?? '').split(' ').some((part) => {
    const sig = part.replace(/^v1=/, '');
    return (
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    );
  });
}

const nodeOk = verify(rawBody, headers, secret);
const nodeTampered = verify(rawBody + ' ', headers, secret);

// --- Python sample: written verbatim, executed with the local interpreter ---
const pythonSample = `
import hashlib, hmac, time

def verify(raw_body: bytes, headers: dict, secret: str, tolerance_sec: int = 300) -> bool:
    ts = headers.get("hookline-timestamp")
    if ts is None or abs(time.time() - int(ts)) > tolerance_sec:
        return False
    expected = hmac.new(secret.encode(), ts.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return any(
        hmac.compare_digest(part.removeprefix("v1="), expected)
        for part in headers.get("hookline-signature", "").split(" ")
    )

import json, sys
case = json.load(open(sys.argv[1]))
ok = verify(case["rawBody"].encode(), case["headers"], case["secret"])
tampered = verify((case["rawBody"] + " ").encode(), case["headers"], case["secret"])
print(json.dumps({"ok": ok, "tampered": tampered}))
`;
mkdirSync('.tmp-sample-check', { recursive: true });
writeFileSync('.tmp-sample-check/py_verify.py', pythonSample);
writeFileSync('.tmp-sample-check/case.json', JSON.stringify({ rawBody, headers, secret }, null, 2));
const pyOut = JSON.parse(
  execFileSync('python', ['.tmp-sample-check/py_verify.py', '.tmp-sample-check/case.json'], {
    encoding: 'utf8',
  }),
);

rmSync('.tmp-sample-check', { recursive: true, force: true });

const results = {
  node_ok: nodeOk,
  node_tampered_rejected: nodeTampered === false,
  python_ok: pyOut.ok === true,
  python_tampered_rejected: pyOut.tampered === false,
};
console.log(JSON.stringify(results, null, 2));
const pass = Object.values(results).every(Boolean);
process.exitCode = pass ? 0 : 1;
