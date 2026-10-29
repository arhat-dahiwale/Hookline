// Bootstraps a dev `.env` from `.env.example` for fresh clones and CI's e2e
// workflow: keeps the committed dev defaults (compose ports, local URLs) and
// replaces the placeholder secrets with crypto-generated values (AGENTS.md:
// generate secrets with Node's crypto — no openssl, and nothing secret is
// ever committed). An existing `.env` is NEVER touched; re-running is a
// no-op.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
// Test hook: HOOKLINE_ENV_OUT redirects the target so the generator can be
// exercised without touching a real .env.
const target = process.env.HOOKLINE_ENV_OUT ?? join(repoRoot, '.env');

if (existsSync(target)) {
  console.log(`[generate-dev-env] ${target} already exists - leaving it untouched.`);
  process.exit(0);
}

const generated = {
  BETTER_AUTH_SECRET: randomBytes(48).toString('base64'),
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  INTERNAL_GRPC_TOKEN: randomBytes(32).toString('hex'),
};

const source = readFileSync(join(repoRoot, '.env.example'), 'utf8');
const output = source
  .split('\n')
  .map((line) => {
    const placeholder = /^([A-Z0-9_]+)=(replace-with-\S+)\s*$/.exec(line);
    if (!placeholder) return line;
    const value = generated[placeholder[1]] ?? randomBytes(32).toString('hex');
    return `${placeholder[1]}=${value}`;
  })
  .join('\n');

// 'wx' fails rather than overwrites if a concurrent run raced us here.
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output, { flag: 'wx' });
console.log(`[generate-dev-env] wrote ${target} with generated dev-only secrets.`);
