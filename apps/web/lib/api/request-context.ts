import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * What every audit write needs to know about the request it runs in, without
 * every route passing it (C-9.8). The wrapper sets it for the life of the
 * handler; writeAudit reads it. Nothing else should.
 */
export interface RequestContext {
  readonly correlationId: string;
  /** The device header, validated, or null when the request did not carry one (a browser). */
  readonly deviceId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> =>
  storage.run(ctx, fn);

export const currentRequestContext = (): RequestContext | undefined => storage.getStore();
