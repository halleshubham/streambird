import { TimeoutError, withTimeout } from './with-timeout';

describe('withTimeout', () => {
  afterEach(() => jest.useRealTimers());

  it('passes the result (and a rejection) straight through when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000, 'x')).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'x')).rejects.toThrow('boom');
  });

  it('gives up on work that never settles, saying what it was waiting for', async () => {
    jest.useFakeTimers();
    const p = withTimeout(new Promise(() => undefined), 5000, 'Ending the youtube broadcast');
    const assertion = expect(p).rejects.toThrow('Ending the youtube broadcast did not answer within 5s');
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
    await expect(p).rejects.toBeInstanceOf(TimeoutError);
  });

  it('leaves no timer behind once the work is done', async () => {
    jest.useFakeTimers();
    await withTimeout(Promise.resolve(1), 60_000, 'x');
    expect(jest.getTimerCount()).toBe(0);
  });
});
