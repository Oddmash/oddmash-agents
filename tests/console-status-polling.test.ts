import assert from 'node:assert/strict';
import test from 'node:test';
import { createStatusPolling, type PollResult } from '../apps/console/src/status-polling.ts';

const fixture = () => {
  let hidden = false;
  let next = 0;
  let errors = 0;
  let settled = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>();
  const requests: { signal: AbortSignal; resolve: (value: PollResult) => void; reject: (error: Error) => void }[] = [];
  const polling = createStatusPolling({
    hidden: () => hidden,
    fetchStatus: signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject })),
    onError: () => { errors++; },
    onSettled: () => { settled++; },
    schedule: (callback, delay) => { const id = ++next; timers.set(id, { callback, delay }); return id as unknown as ReturnType<typeof setTimeout>; },
    cancel: timer => { timers.delete(timer as unknown as number); }
  });
  const complete = async (index: number, result: PollResult = { delayMs: 10000 }) => {
    requests[index].resolve(result);
    await Promise.resolve();
  };
  return { polling, requests, timers, complete, hide: (value: boolean) => { hidden = value; polling.visibilityChanged(); }, errors: () => errors, settled: () => settled };
};

test('manual refresh while paused is one-shot and resume restarts polling', async () => {
  const f = fixture();
  void f.polling.refresh();
  await f.complete(0);
  assert.equal(f.timers.size, 1);
  f.polling.setPaused(true);
  assert.equal(f.timers.size, 0);
  void f.polling.refresh();
  await f.complete(1);
  assert.equal(f.timers.size, 0);
  f.polling.setPaused(false);
  assert.equal(f.requests.length, 3);
  await f.complete(2);
  assert.equal(f.timers.size, 1);
});

test('visibility cancellation does not announce a failure and wakes immediately', async () => {
  const f = fixture();
  void f.polling.refresh();
  f.hide(true);
  assert.equal(f.requests[0].signal.aborted, true);
  f.hide(false);
  f.requests[0].reject(new Error('aborted'));
  await Promise.resolve();
  assert.equal(f.errors(), 0);
  assert.equal(f.requests.length, 2);
  await f.complete(1);
  assert.equal(f.settled(), 1);
});

test('expiration stops automatic polling and disposal clears timers', async () => {
  const f = fixture();
  void f.polling.refresh();
  await f.complete(0, { delayMs: 30000, expired: true });
  assert.equal(f.timers.size, 0);
  f.hide(true);
  f.hide(false);
  assert.equal(f.requests.length, 1);
  void f.polling.refresh();
  assert.equal(f.requests.length, 2);
  f.polling.dispose();
  assert.equal(f.requests[1].signal.aborted, true);
  await f.complete(1);
  assert.equal(f.timers.size, 0);
});

test('a fresh session snapshot defers the first poll and manual refresh cancels that delay', async () => {
  const f = fixture();
  f.polling.start(4000);
  assert.equal(f.requests.length, 0);
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [4000]);
  void f.polling.refresh();
  assert.equal(f.requests.length, 1);
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [15000]);
  await f.complete(0);
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [10000]);
});

test('a timed-out status fetch reports failure and schedules the normal error backoff', async () => {
  const f = fixture();
  void f.polling.refresh();
  const [timeout] = f.timers.values();
  assert.equal(timeout.delay, 15000);
  f.requests[0].signal.addEventListener('abort', () => f.requests[0].reject(new Error('Request aborted')));
  timeout.callback();
  await Promise.resolve();
  assert.equal(f.errors(), 1);
  assert.equal(f.settled(), 1);
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [30000]);
});
