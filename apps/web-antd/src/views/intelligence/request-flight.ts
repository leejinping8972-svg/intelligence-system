// Concurrent consumers await the same result, including errors. A completed read
// is not cached here: an explicit refresh must always be able to fetch new data.
export class RequestFlight<T> {
  private pending?: Promise<T>;
  run(load: () => Promise<T>): Promise<T> {
    if (this.pending) return this.pending;
    const result = Promise.resolve().then(load);
    this.pending = result;
    void result
      .finally(() => {
        if (this.pending === result) this.pending = undefined;
      })
      .catch(() => {});
    return result;
  }
}
