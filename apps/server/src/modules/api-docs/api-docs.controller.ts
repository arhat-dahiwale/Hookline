import { Controller, Get } from '@nestjs/common';

import { buildOpenApiDocument } from './openapi.js';

@Controller()
export class ApiDocsController {
  private document: Record<string, unknown> | undefined;

  @Get('openapi.json')
  openapi(): Record<string, unknown> {
    this.document ??= buildOpenApiDocument();
    return this.document;
  }
}
