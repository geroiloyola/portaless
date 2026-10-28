// Bounds the number of simultaneous scrypt verifications. scrypt N=2^17 uses
// ~128 MiB per call; without this, a burst of login attempts is a memory/CPU
// amplifier. The queue is bounded by the runtime's request concurrency.
class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.active < this.limit) {
      this.active += 1;
      try {
        return await task();
      } finally {
        this.active -= 1;
        this.drain();
      }
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
    });
  }

  drain() {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      this.active += 1;
      Promise.resolve()
        .then(next.task)
        .then(next.resolve, next.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

const semaphores = new Map();

export function loginConcurrencyLimit(env = {}) {
  const raw = Number(env?.PORTALESS_LOGIN_CONCURRENCY);
  if (!Number.isInteger(raw) || raw < 1 || raw > 64) return 4;
  return raw;
}

export function getLoginSemaphore(env = {}) {
  const limit = loginConcurrencyLimit(env);
  let semaphore = semaphores.get(limit);
  if (!semaphore) {
    semaphore = new Semaphore(limit);
    semaphores.set(limit, semaphore);
  }
  return semaphore;
}

export function runWithLoginConcurrency(env, task) {
  return getLoginSemaphore(env).run(task);
}

/** Solo para tests: reinicia los semáforos del proceso. */
export function __resetLoginConcurrencyForTests() {
  semaphores.clear();
}
