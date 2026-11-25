export type PollResult = { delayMs: number; expired?: boolean };
type Timer = ReturnType<typeof setTimeout>;
type Options = {
  hidden: () => boolean;
  fetchStatus: (signal: AbortSignal) => Promise<PollResult>;
  onError: () => void;
  onSettled: () => void;
  schedule?: (callback: () => void, delay: number) => Timer;
  cancel?: (timer: Timer) => void;
};

export function createStatusPolling(options: Options) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let paused = false;
  let expired = false;
  let disposed = false;
  let timer: Timer | undefined;
  let current: { controller: AbortController; visibilityCancelled: boolean } | undefined;
  let wakePending = false;

  const clearTimer = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const canPoll = () => !disposed && !paused && !expired && !options.hidden();

  async function refresh() {
    if (disposed || options.hidden() || expired || current) return;
    clearTimer();
    const request = { controller: new AbortController(), visibilityCancelled: false };
    current = request;
    let delay = 30000;
    const timeout = schedule(() => request.controller.abort(), 15000);
    try {
      const result = await options.fetchStatus(request.controller.signal);
      if (!disposed && !request.visibilityCancelled) {
        delay = result.delayMs;
        expired = result.expired === true;
      }
    } catch {
      if (!disposed && !request.visibilityCancelled) options.onError();
    } finally {
      cancel(timeout);
      current = undefined;
      if (!disposed && !request.visibilityCancelled) options.onSettled();
      if (wakePending && canPoll()) {
        wakePending = false;
        void refresh();
      } else {
        wakePending = false;
        if (canPoll()) timer = schedule(() => { if (canPoll()) void refresh(); }, delay);
      }
    }
  }

  return {
    refresh: () => { expired = false; return refresh(); },
    setPaused(value: boolean) {
      paused = value;
      clearTimer();
      if (!paused && canPoll()) {
        if (current?.visibilityCancelled) wakePending = true;
        else void refresh();
      }
    },
    visibilityChanged() {
      clearTimer();
      if (options.hidden()) {
        wakePending = false;
        if (current) {
          current.visibilityCancelled = true;
          current.controller.abort();
        }
      } else if (canPoll()) {
        if (current?.visibilityCancelled) wakePending = true;
        else void refresh();
      }
    },
    dispose() {
      disposed = true;
      clearTimer();
      current?.controller.abort();
    }
  };
}
