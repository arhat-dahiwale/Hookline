import 'dotenv/config';

import { config as loadDotenvFile } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

for (const path of ['.env', '../../.env']) {
  loadDotenvFile({ path, quiet: true });
}

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/auth/auth-schema.ts',
    './src/modules/api-keys/api-keys.schema.ts',
    './src/modules/endpoints/endpoints.schema.ts',
    './src/modules/events/events.schema.ts',
    './src/modules/deliveries/deliveries.schema.ts',
    './src/modules/audit/audit.schema.ts',
    './src/modules/analytics/analytics.schema.ts',
  ],
  out: './drizzle',
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
