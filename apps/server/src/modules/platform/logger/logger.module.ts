import { Global, Module } from '@nestjs/common';

import { PinoLoggerService } from './pino-logger.service.js';

@Global()
@Module({
  providers: [PinoLoggerService],
  exports: [PinoLoggerService],
})
export class LoggerModule {}
