// Run a check at most once per message, even if several hook entries fire for it.
// This happens when a tool loads decaf from two places (e.g. Cursor reads both its own
// hooks.json and the Claude Code plugin), or calls the hook twice.
// The first caller takes a lock and runs; the others wait for its result.
// If the first caller fails, the lock is released and a waiting caller runs instead.
import { createHash } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DECAF_HOME } from './config.js';

const TTL_MS = 2 * 60 * 1000; // reuse a finished result for this long
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function messageKey(input) {
  const conv = input?.conversation_id || input?.session_id || '';
  return createHash('sha256').update(`${conv}\n${input?.prompt || ''}`).digest('hex').slice(0, 32);
}

function fresh(path, ttl) {
  try {
    return Date.now() - statSync(path).mtimeMs < ttl;
  } catch {
    return false;
  }
}

function cleanup(dir) {
  try {
    for (const f of readdirSync(dir)) if (!fresh(join(dir, f), 10 * TTL_MS)) rmSync(join(dir, f), { force: true });
  } catch {}
}

// fn() returns a result; ok(result) says whether it may be shared.
export async function once(key, { waitMs, fn, ok }) {
  const dir = join(DECAF_HOME, 'inflight');
  mkdirSync(dir, { recursive: true });
  const res = join(dir, `${key}.json`);
  const lock = join(dir, `${key}.lock`);
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    if (fresh(res, TTL_MS)) {
      try { return JSON.parse(readFileSync(res, 'utf8')); } catch {}
    }
    if (existsSync(lock) && !fresh(lock, waitMs)) rmSync(lock, { force: true }); // stale lock
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch {
      await sleep(200); // someone else is running it
      continue;
    }
    closeSync(fd);
    try {
      const out = await fn();
      if (ok(out)) writeFileSync(res, JSON.stringify(out));
      return out;
    } finally {
      rmSync(lock, { force: true });
      cleanup(dir);
    }
  }
  return fn(); // waited too long; run it ourselves
}
