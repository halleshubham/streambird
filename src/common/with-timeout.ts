export class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} did not answer within ${Math.round(ms / 1000)}s`);
    this.name = 'TimeoutError';
  }
}

/**
 * Rejects if `work` has not settled within `ms`. For cleanup calls to other services (a platform, MediaMTX) that
 * have no timeout of their own: a call that hangs must not hang the thing that is trying to finish, such as ending a
 * stream. The work itself is not cancelled; we just stop waiting for it.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
