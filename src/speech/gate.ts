/**
 * Sequential-inference gate (ADR-0005, RAM constraint): STT and LLM work are
 * never allowed to run concurrently on this host. One process-wide gate;
 * holders wrap their entire heavy operation. Acquisition is FIFO via a queue
 * of resolvers — no starvation, no busy wait.
 */
export class InferenceGate {
  private busy = false;
  private readonly queue: Array<() => void> = [];

  async acquire(): Promise<void> {
    if (!this.busy) {
      this.busy = true;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      next(); // hand ownership directly to the next waiter
    } else {
      this.busy = false;
    }
  }

  /** Exclusive section helper — always releases, even on throw. */
  async run<T>(section: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await section();
    } finally {
      this.release();
    }
  }

  get isBusy(): boolean {
    return this.busy;
  }
}

/** Process-wide singleton shared by STT and LLM paths. */
export const inferenceGate = new InferenceGate();
