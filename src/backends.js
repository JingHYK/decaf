// Model backends. Each one uses the login of the tool the user already has:
//   claude -> Claude Code CLI with the user's Claude subscription
//   codex  -> `codex exec` with the user's Codex login
//   cursor -> Cursor CLI (`agent -p`) with the user's Cursor login
// decaf never sends text anywhere else.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECAF_HOME, modelFor } from './config.js';

export const TOKEN_PATH = () => join(DECAF_HOME, 'claude-token');

// The command that saves a Claude token, with this install's real path, for the
// notice shown when the Claude check cannot log in.
export const SET_TOKEN_CMD = `node "${join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'decaf.js')}" set-token`;
const AUTH_ERROR = /authenticat|not logged in|log ?in|oauth|401|credential/i;

export function readClaudeToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return null; // already in env, inherited by child
  try {
    return readFileSync(TOKEN_PATH(), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function which(cmd) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    const p = join(dir, cmd);
    if (existsSync(p)) return p;
  }
  return null;
}

export function run(bin, args, { input, timeoutMs, env, cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      // DECAF_INNER stops our own hook from firing inside the nested call.
      env: { ...process.env, ...env, DECAF_INNER: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(cwd ? { cwd } : {}),
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(`${bin} exited ${code}: ${(err || out).trim().slice(0, 300)}`));
    });
    child.stdin.end(input ?? '');
  });
}

// The Claude desktop app ships its own claude binary under
// ~/Library/Application Support/Claude/claude-code/<version>/<hash>/claude.app/...
function desktopClaude() {
  if (process.platform !== 'darwin') return null;
  const root = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code');
  const found = [];
  try {
    for (const ver of readdirSync(root)) {
      let hashes = [];
      try { hashes = readdirSync(join(root, ver)); } catch { continue; }
      for (const h of hashes) {
        const p = join(root, ver, h, 'claude.app', 'Contents', 'MacOS', 'claude');
        if (existsSync(p)) found.push({ p, t: statSync(p).mtimeMs });
      }
    }
  } catch {}
  found.sort((a, b) => b.t - a.t);
  return found[0]?.p || null;
}

export function findClaude() {
  const candidates = [
    process.env.DECAF_CLAUDE_BIN,
    which('claude'),
    join(homedir(), '.claude', 'local', 'claude'),
    join(homedir(), '.local', 'bin', 'claude'),
    process.env.CLAUDE_CODE_EXECPATH, // set by Claude Code for its child processes
    desktopClaude(),
  ];
  return candidates.find((p) => p && existsSync(p)) || null;
}

// The Cursor CLI saves every `agent -p` call as a chat (about 120 KB each) and has
// no option to turn that off. decaf runs it in its own empty workspace, so every
// chat stored for that workspace is one of decaf's checks. Remove the ones older
// than a few minutes (never one that may still be running).
const CURSOR_KEEP_MS = 5 * 60 * 1000;
export function cleanCursorChats(workspace, home = homedir(), now = Date.now()) {
  const dirs = [
    join(home, '.cursor', 'chats', createHash('md5').update(workspace).digest('hex')),
    join(home, '.cursor', 'projects', workspace.replace(/^\//, '').replace(/[^A-Za-z0-9]+/g, '-'), 'agent-transcripts'),
  ];
  let removed = 0;
  for (const dir of dirs) {
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const p = join(dir, n);
      try {
        if (now - statSync(p).mtimeMs > CURSOR_KEEP_MS) { rmSync(p, { recursive: true, force: true }); removed++; }
      } catch {}
    }
  }
  return removed;
}

const backends = {
  async claude(system, input, cfg) {
    const bin = findClaude();
    if (!bin) throw new Error('claude CLI not found');
    const token = readClaudeToken();
    let out;
    try {
      out = await run(
        bin,
        ['-p', '--model', cfg.models.claude, '--output-format', cfg.usage ? 'json' : 'text', '--no-session-persistence',
         '--settings', '{"disableAllHooks": true}', '--tools', '', '--system-prompt', system],
        { input, timeoutMs: cfg.timeoutMs, env: token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {} }
      );
    } catch (e) {
      if (AUTH_ERROR.test(e.message)) throw Object.assign(new Error('Claude login needed'), { code: 'NO_TOKEN' });
      throw e;
    }
    if (!cfg.usage) return out;
    const j = JSON.parse(out);
    const [model, u] = Object.entries(j.modelUsage || {})[0] || [];
    return { text: j.result, usage: { model, input: u?.inputTokens, cacheRead: u?.cacheReadInputTokens, cacheWrite: u?.cacheCreationInputTokens, output: u?.outputTokens, listCostUSD: j.total_cost_usd } };
  },

  async codex(system, input, cfg) {
    const bin = process.env.DECAF_CODEX_BIN || which('codex');
    if (!bin) throw new Error('codex CLI not found');
    const dir = mkdtempSync(join(tmpdir(), 'decaf-'));
    const outFile = join(dir, 'last.txt');
    const args = ['exec', '--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only',
      '-c', 'features.hooks=false', '-c', `model_reasoning_effort=${cfg.codexReasoningEffort}`,
      '--output-last-message', outFile];
    if (cfg.models.codex) args.push('--model', cfg.models.codex);
    if (cfg.usage) args.push('--json');
    args.push('-');
    try {
      const out = await run(bin, args, { input: `${system}\n\n${input}`, timeoutMs: cfg.timeoutMs, cwd: dir });
      const text = readFileSync(outFile, 'utf8');
      if (!cfg.usage) return text;
      let u = {};
      for (const line of out.split('\n')) {
        try { const e = JSON.parse(line); if (e.type === 'turn.completed') u = e.usage || {}; } catch {}
      }
      return { text, usage: { model: cfg.models.codex, input: (u.input_tokens || 0) - (u.cached_input_tokens || 0), cacheRead: u.cached_input_tokens, output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) } };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },

  async cursor(system, input, cfg) {
    const candidates = [process.env.DECAF_CURSOR_BIN, which('agent'), which('cursor-agent'), join(homedir(), '.local', 'bin', 'agent')];
    const bin = candidates.find((p) => p && existsSync(p));
    if (!bin) throw new Error(`Cursor CLI (agent) not found (HOME=${homedir()}, tried ${candidates.filter(Boolean).join(', ')})`);
    // Read-only: ask mode (no edits), sandbox on, and one fixed empty folder as the
    // workspace (a new folder per call would pile up in Cursor's project list).
    const dir = join(DECAF_HOME, 'cursor-workspace');
    mkdirSync(dir, { recursive: true });
    const args = ['-p', '--output-format', cfg.usage ? 'json' : 'text', '--mode', 'ask', '--sandbox', 'enabled', '--trust', '--workspace', dir];
    const model = modelFor(cfg, 'cursor');
    if (model) args.push('--model', model);
    args.push(`${system}\n\n${input}`);
    let out;
    try {
      out = await run(bin, args, { timeoutMs: cfg.timeoutMs, cwd: dir });
    } finally {
      cleanCursorChats(dir);
    }
    if (!cfg.usage) return out;
    const j = JSON.parse(out);
    const u = j.usage || {};
    return { text: j.result, usage: { model, input: u.inputTokens, cacheRead: u.cacheReadTokens, cacheWrite: u.cacheWriteTokens, output: u.outputTokens } };
  },
};

// Which backend to use: the configured one, or the host that called the hook.
export function pickBackend(cfg, host) {
  if (cfg.backend && cfg.backend !== 'auto') return cfg.backend;
  return { 'claude-code': 'claude', codex: 'codex', cursor: 'cursor' }[host] || 'claude';
}

export async function callModel(name, system, input, cfg) {
  const fn = backends[name];
  if (!fn) throw new Error(`unknown backend: ${name}`);
  return fn(system, input, cfg);
}
