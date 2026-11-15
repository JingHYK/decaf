// One model call per message: rate severity, and rewrite if severity >= 2.
// The model comes from the tool that called the hook (see backends.js).
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callModel, pickBackend } from './backends.js';
import { DECAF_HOME, loadConfig, modelFor } from './config.js';

const PROMPT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'check.md');
export const CHECK_PROMPT = () => readFileSync(PROMPT_PATH, 'utf8');

// Take the first complete {...} object, ignoring anything the model adds after it.
function firstJsonObject(s) {
  const a = s.indexOf('{');
  if (a < 0) throw new Error('no JSON in model output');
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(s.slice(a, i + 1));
  }
  throw new Error('unterminated JSON in model output');
}

export function parseCheck(raw) {
  const o = firstJsonObject(String(raw || ''));
  const severity = Number(o.severity);
  if (![0, 1, 2, 3].includes(severity)) throw new Error('bad severity');
  return {
    severity,
    kind: String(o.kind || o.what || '').trim(),
    rewritten: typeof o.rewritten === 'string' ? o.rewritten.trim() : '',
    changes: Array.isArray(o.changes)
      ? o.changes.filter((c) => c && typeof c.from === 'string').map((c) => ({ from: c.from, to: String(c.to ?? '') }))
      : [],
  };
}

export async function callCheck(text, cfg, host) {
  if (process.env.DECAF_MOCK_RESPONSE !== undefined) return process.env.DECAF_MOCK_RESPONSE;
  return callModel(pickBackend(cfg, host), CHECK_PROMPT(), `<message>\n${text}\n</message>`, cfg);
}

function log(cfg, entry) {
  if (!cfg.log) return;
  try {
    mkdirSync(DECAF_HOME, { recursive: true });
    appendFileSync(join(DECAF_HOME, 'log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

// Returns { action: 'pass'|'rewrite'|'error', severity?, kind?, rewritten?, changes?, ms, error? }
export async function check(text, { cfg = loadConfig(), host } = {}) {
  const t0 = Date.now();
  let out;
  try {
    const raw = await callCheck(text, cfg, host);
    let r;
    try { r = parseCheck(raw); } catch (e) { e.raw = raw; throw e; }
    const rewrite = r.severity >= cfg.minSeverity && r.rewritten && r.rewritten !== text.trim();
    out = { action: rewrite ? 'rewrite' : 'pass', ...r, ms: Date.now() - t0 };
  } catch (e) {
    out = { action: 'error', error: e.message, ...(e.code ? { code: e.code } : {}), raw: String(e.raw || '').slice(0, 500), ms: Date.now() - t0 };
  }
  const backend = pickBackend(cfg, host);
  log(cfg, { original: text, backend, model: modelFor(cfg, backend) || 'default', ...(cfg.chatModel ? { chatModel: cfg.chatModel } : {}), ...out });
  return out;
}
