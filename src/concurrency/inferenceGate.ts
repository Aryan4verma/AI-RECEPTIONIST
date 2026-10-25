import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Sequential-inference gate (ADR-0005, RAM constraint): STT and every LLM
 * call (including registry-selected providers) hold ONE process-wide gate, so
 * heavy inference never overlaps on this host. REENTRANT within a single
 * logical flow (AsyncLocalStorage): a gated section that internally triggers
 * another gated call passes through instead of deadlocking on itself, while
 * a DIFFERENT flow still waits its turn (FIFO).
 */
export class InferenceGate {
  private busy = false;
  private readonly queue: Array<() => void> = [];
  private readonly als = new AsyncLocalStorage<{ depth: number }>();

  private acquireRaw(): Promise<void> {
    if (!this.busy) {
      this.busy = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  private releaseRaw(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // hand ownership directly to the next waiter
    } else {
      this.busy = false;
    }
  }

  /** Exclusive section — reentrant per async flow, FIFO across flows. */
  async run<T>(section: () => Promise<T>): Promise<T> {
    const store = this.als.getStore();
    if (store && store.depth > 0) {
      store.depth += 1;
      try {
        return await section();
      } finally {
        store.depth -= 1;
      }
    }
    return this.als.run({ depth: 1 }, async () => {
      await this.acquireRaw();
      try {
        return await section();
      } finally {
        this.releaseRaw();
      }
    });
  }

  get isBusy(): boolean {
    return this.busy;
  }
}

/** Process-wide singleton shared by STT and ALL LLM providers. */
export const inferenceGate = new InferenceGate();
