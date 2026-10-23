import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const base64Key32 = z
  .string()
  .min(1)
  .refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'must be 32 bytes encoded as base64',
  });

/**
 * All runtime configuration. Validated once at startup with Zod; the app
 * refuses to boot on invalid config (ARCHITECTURE.md section 9).
 */
export const envSchema = z.object({
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('postgres'), {
      message: 'must be a postgres:// or postgresql:// connection string',
    }),
  REDIS_URL: z
    .string()
    .min(1)
    .refine((value) => value.startsWith('redis'), {
      message: 'must be a redis:// or rediss:// connection string',
    }),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  ENCRYPTION_KEY: base64Key32,

  INTERNAL_GRPC_TOKEN: z.string().min(16),
  WORKER_GRPC_URL: z.string().min(1).default('localhost:50051'),
  GRPC_PORT: z.coerce.number().int().min(1).max(65535).default(50051),

  OTEL_SERVICE_NAME: z.string().min(1).default('hookline'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),

  ALLOW_INSECURE_ENDPOINTS: booleanFromString,
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(30_000),
  DELIVERY_CONCURRENCY: z.coerce.number().int().min(1).max(256).default(10),

  RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
});

export type Env = z.infer<typeof envSchema>;
