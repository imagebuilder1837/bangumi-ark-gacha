// The single list-request gate for one page. Cancellation removes queued work as well
// as aborting work already dispatched; the client starts its timeout at dispatch.
export class PageScheduler {
  constructor(client, limit = 4) {
    this.client = client;
    this.limit = limit;
    this.queue = [];
    this.running = new Set();
    this.foreground = new Set();
    this.order = new Map();
  }

  setForeground(statuses) {
    this.foreground = new Set(statuses);
    this.drain();
  }

  request(status, page, signal) {
    if (signal.aborted)
      return Promise.reject(new DOMException("Aborted", "AbortError"));
    if (!this.order.has(status)) this.order.set(status, this.order.size);
    return new Promise((resolve, reject) => {
      const job = {
        status,
        page,
        signal,
        resolve,
        reject,
        controller: new AbortController(),
      };
      job.abort = () => {
        this.queue = this.queue.filter((entry) => entry !== job);
        job.controller.abort();
        this.running.delete(job);
        reject(new DOMException("Aborted", "AbortError"));
        this.drain();
      };
      signal.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this.drain();
    });
  }

  drain() {
    while (this.running.size < this.limit && this.queue.length) {
      const foregroundActive =
        [...this.running].some((job) => this.foreground.has(job.status)) ||
        this.queue.some((job) => this.foreground.has(job.status));
      const candidates = this.queue.filter((job) =>
        foregroundActive ? this.foreground.has(job.status) : true,
      );
      if (!candidates.length) return;
      candidates.sort(
        (a, b) => this.order.get(a.status) - this.order.get(b.status),
      );
      const job = candidates[0];
      this.queue.splice(this.queue.indexOf(job), 1);
      if (job.signal.aborted) continue;
      this.running.add(job);
      Promise.resolve()
        .then(() => {
          if (job.signal.aborted)
            throw new DOMException("Aborted", "AbortError");
          return this.client.fetchListPage(
            job.status,
            job.page,
            job.controller.signal,
            true,
          );
        })
        .then(job.resolve, job.reject)
        .finally(() => {
          job.signal.removeEventListener("abort", job.abort);
          this.running.delete(job);
          this.drain();
        });
    }
  }
}
