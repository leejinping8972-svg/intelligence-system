import type { SourceUsagePending } from './source-usage';

export function waitForUsageRetry(signal: AbortSignal, milliseconds: number) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, milliseconds);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

export function createUsageLoader<
  T extends { refreshing?: boolean; refreshError?: string },
>(callbacks: {
  apply: (value: T) => Promise<void> | void;
  busy: (value: boolean) => void;
  error: (value: string) => void;
}) {
  let revision = 0;
  let controller: AbortController | undefined;
  return {
    get signal() {
      return controller?.signal;
    },
    stop() {
      revision++;
      controller?.abort();
      callbacks.busy(false);
    },
    async load(
      request: (refresh: boolean) => Promise<SourceUsagePending | T>,
      refresh = false,
    ) {
      const current = ++revision;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      callbacks.busy(true);
      callbacks.error('');
      try {
        for (;;) {
          const result = await request(refresh);
          if (current !== revision || signal.aborted) return false;
          if (!('loading' in result)) {
            await callbacks.apply(result);
            if (current !== revision || signal.aborted) return false;
            if (result.refreshError) callbacks.error(result.refreshError);
            if (!result.refreshing || result.refreshError) return true;
          }
          await waitForUsageRetry(
            signal,
            'loading' in result
              ? Math.max(1000, Math.min(5000, result.retryAfterMs || 2000))
              : 2000,
          );
          if (current !== revision || signal.aborted) return false;
          refresh = false;
        }
      } catch (cause) {
        if (current === revision && !signal.aborted)
          callbacks.error(
            cause instanceof Error ? cause.message : '记录读取失败，请稍后重试',
          );
      } finally {
        if (current === revision) callbacks.busy(false);
      }
      return false;
    },
  };
}
