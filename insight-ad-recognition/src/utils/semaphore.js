/**
 * Simple counting semaphore to bound the number of concurrent heavy jobs while still accepting
 * concurrent HTTP requests (extra requests queue instead of overwhelming ffmpeg/whisper/models).
 */

export class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max | 0);
    this.active = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  release() {
    this.active -= 1;
    const next = this.queue.shift();
    if (next) next();
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export default Semaphore;
