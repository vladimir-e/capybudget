/** Create a debounced writer that batches rapid calls. */
export function createDebouncedWriter(
  fn: () => Promise<void>,
  delayMs = 300,
  onError?: (error: unknown) => void,
): { schedule(): void; flush(): Promise<void> } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Promise<void> | null = null;

  const flush = async () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending) await pending;
    pending = fn().finally(() => { pending = null; });
    await pending;
  };

  const schedule = () => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const prev = pending ?? Promise.resolve();
      pending = prev
        .then(() => fn())
        .catch((err) => { onError?.(err); })
        .finally(() => { pending = null; });
    }, delayMs);
  };

  return { schedule, flush };
}
