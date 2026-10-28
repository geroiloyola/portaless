// Bounds the number of simultaneous async scrypt verifications. scrypt N=2^17
// uses ~128 MiB per call; without this, a burst of login attempts is a memory
// amplifier. The queue is bounded: once it is full (or a request waits too
// long), the endpoint answers 503 instead of accumulating work.
const DEFAULT_QUEUE_MAX = 32;
const DEFAULT_QUEUE_TIMEOUT_MS = 2000;

export class LoginBusyError extends Error {
  constructor(reason) {
    super(reason === "queue_full" ? "login queue is full" : "login queue wait timed out");
    this.name = "LoginBusyError";
    this.code = "login_busy";
    this.reason = reason;
  }
}

class Semaphore {
  constructor(limit) {
    this.limit = limit;
    this.active = 0;
    this.queue = [];
  }

  async start(task) {
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.drain();
    }
  }

  run(task, { maxQueue, timeoutMs }) {
    if (this.active < this.limit) return this.start(task);
    if (this.queue.length >= maxQueue) {
      return Promise.reject(new LoginBusyError("queue_full"));
    }
    return new Promise((resolve, reject) => {
      const entry = { task, resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        const index = this.queue.indexOf(entry);
        if (index !== -1) this.queue.splice(index, 1);
        reject(new LoginBusyError("queue_timeout"));
      }, timeoutMs);
      this.queue.push(entry);
    });
  }

  drain() {
    while (this.active < this.limit && this.queue.length > 0) {
      const next = this.queue.shift();
      clearTimeout(next.timer);
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

export function loginQueueMax(env = {}) {
  const raw = Number(env?.PORTALESS_LOGIN_QUEUE_MAX);
  if (!Number.isInteger(raw) || raw < 0 || raw > 1024) return DEFAULT_QUEUE_MAX;
  return raw;
}

export function loginQueueTimeoutMs(env = {}) {
  const raw = Number(env?.PORTALESS_LOGIN_QUEUE_TIMEOUT_MS);
  if (!Number.isInteger(raw) || raw < 10 || raw > 60_000) return DEFAULT_QUEUE_TIMEOUT_MS;
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
  return getLoginSemaphore(env).run(task, {
    maxQueue: loginQueueMax(env),
    timeoutMs: loginQueueTimeoutMs(env),
  });
}

/** Solo para tests: reinicia los semáforos del proceso. */
export function __resetLoginConcurrencyForTests() {
  semaphores.clear();
}
