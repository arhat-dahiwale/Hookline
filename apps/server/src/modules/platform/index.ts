/**
 * Public surface of the platform module. Other modules may also import
 * platform sub-paths directly (config, logger, errors) — see the eslint
 * boundary rules.
 */
export {
  APP_CONFIG,
  type AppConfig,
  parseEnv,
  loadAppConfig,
  InvalidConfigError,
} from './config/app-config.js';
export { ConfigModule } from './config/config.module.js';
export { PinoLoggerService } from './logger/pino-logger.service.js';
export { LoggerModule } from './logger/logger.module.js';
export {
  requestContextStorage,
  getCurrentRequestContext,
  type RequestContext,
} from './logger/request-context.js';
export { DatabaseService } from './database/database.service.js';
export { DatabaseModule } from './database/database.module.js';
export { TenantScope, tenantScope } from './database/tenant-scope.js';
export { SecretCipher } from './crypto/secret-cipher.js';
export { RedisService } from './redis/redis.service.js';
export { RedisModule } from './redis/redis.module.js';
export { AppError, type ErrorDetail } from './errors/app-error.js';
export * as errors from './errors/app-error.js';
export { ERROR_CODES, type ErrorCode, statusForCode, codeForStatus } from './errors/error-codes.js';
export { buildErrorBody, type ErrorBody } from './errors/error-body.js';
export { AllExceptionsFilter } from './errors/all-exceptions.filter.js';
export { ShutdownService } from './shutdown/shutdown.service.js';
export { PlatformModule } from './platform.module.js';
