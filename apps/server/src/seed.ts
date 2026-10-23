/**
 * Seed: demo org, user, endpoints, and one API key (secret printed once).
 * Run with `pnpm db:seed` against the dev database.
 */
import { randomBytes } from 'node:crypto';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { ApiKeysRepository } from './modules/api-keys/api-keys.repository.js';
import { ApiKeysService } from './modules/api-keys/index.js';
import { AuditService } from './modules/audit/index.js';
import { createAuth } from './modules/auth/auth-options.js';
import { member, organization, user } from './modules/auth/auth-schema.js';
import { loadAppConfig } from './modules/platform/config/app-config.js';
import { DatabaseService } from './modules/platform/database/database.service.js';
import { tenantScope } from './modules/platform/database/tenant-scope.js';
import { SecretCipher } from './modules/platform/crypto/secret-cipher.js';
import { RedisService } from './modules/platform/redis/redis.service.js';
import { EndpointsRepository } from './modules/endpoints/endpoints.repository.js';
import { EndpointsService } from './modules/endpoints/index.js';

const DEMO_EMAIL = 'demo@hookline.test';
const DEMO_PASSWORD = 'demo-password-123';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });
  const db = drizzle(pool);

  const auth = createAuth(db, {
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    useSecureCookies: false,
  });

  const [alreadyThere] = await db.select().from(user).limit(1);
  if (alreadyThere) {
    process.stdout.write('seed: users already exist; delete the database to reseed\n');
    await pool.end();
    process.exit(0);
  }

  // Demo user via the email sign-up endpoint (Better Auth hashes the password).
  const signUp = await auth.api.signUpEmail({
    body: {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: 'Demo User',
    },
  });
  const demoUserId = signUp.user.id;

  // Demo organization with the user as owner.
  const [org] = await db
    .insert(organization)
    .values({
      id: randomBytes(16).toString('hex'),
      name: 'Demo Org',
      slug: `demo-${randomBytes(4).toString('hex')}`,
      createdAt: new Date(),
      metadata: null,
    })
    .returning();
  await db.insert(member).values({
    id: randomBytes(16).toString('hex'),
    organizationId: org!.id,
    userId: demoUserId,
    role: 'owner',
    createdAt: new Date(),
  });

  // Platform services over standalone connections.
  const database = new DatabaseService(config);
  const redis = new RedisService(config);
  const cipher = new SecretCipher(config);
  const audit = new AuditService(database);
  const endpointsService = new EndpointsService(new EndpointsRepository(database), cipher, audit);
  const apiKeysService = new ApiKeysService(new ApiKeysRepository(database), redis, audit);

  const scope = tenantScope(org!.id);
  const healthy = await endpointsService.create(
    scope,
    { url: 'https://example.com/hooks/healthy', description: 'Demo healthy endpoint' },
    { type: 'system' },
  );
  const failing = await endpointsService.create(
    scope,
    { url: 'https://example.com/hooks/failing', description: 'Demo failing endpoint' },
    { type: 'system' },
  );
  const apiKey = await apiKeysService.create(scope, {
    name: 'Demo key',
    scopes: ['events:write', 'events:read', 'endpoints:read', 'deliveries:read'],
    createdByUserId: demoUserId,
  });

  process.stdout.write(
    [
      '',
      'Hookline seed complete.',
      `  user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
      `  org: ${org!.id}`,
      `  endpoints: ${healthy.endpoint.id}, ${failing.endpoint.id}`,
      '  endpoint secrets (shown once):',
      `    healthy: ${healthy.secret}`,
      `    failing: ${failing.secret}`,
      `  api key (shown once): ${apiKey.secret}`,
      '',
    ].join('\n'),
  );

  await database.pool.end();
  redis.client.disconnect();
  await pool.end();
  process.exit(0);
}

void main().catch((error: unknown) => {
  process.stderr.write(`seed failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
