import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
}

/**
 * Request-scoped context propagated through async hops (services, workers on
 * the request path, exception filter). Pino mixes it into every log line.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getCurrentRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
