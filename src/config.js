import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const DECAF_HOME = process.env.DECAF_HOME || join(homedir(), '.decaf');
export const CONFIG_PATH = () => join(DECAF_HOME, 'config.json');

export const DEFAULTS = {
  enabled: true,
  // auto = use the model of the tool that called the hook (Claude Code / Codex / Cursor)
  // anthropic = call the Anthropic API directly with your API key (fastest; billed to your API account)
  // openai = any OpenAI-compatible endpoint: a local model (Ollama, LM Studio) or a cloud service
  backend: 'auto',
  // Settings for backend: openai. Defaults point at Ollama on this computer.
  openai: { baseUrl: 'http://localhost:11434/v1', model: 'qwen3.5:4b', reasoningEffort: 'none' },
  // Model per backend. null = that tool's own default model.
  // cursor: 'follow' = pick from cursorModelMap by the model you are chatting with in Cursor.
  models: { claude: 'sonnet', codex: 'gpt-5.6-luna', cursor: 'follow', anthropic: 'claude-sonnet-5-5' },
  // Cursor chat model (matched by substring, first match wins) -> lighter model decaf uses.
  // Grok and Composer are in Cursor's included usage; GPT and Claude are billed separately, so those chats keep
  // a model from the same family. 'default' covers Auto, Composer, Grok and anything else.
  cursorModelMap: {
    codex: 'gpt-5.3-codex-low',
    gpt: 'gpt-5.3-codex-low',
    claude: 'claude-sonnet-5-5-low',
    default: 'cursor-grok-4.6-low',
  },
  codexReasoningEffort: 'low',
  // API mode: let the model think before answering (slower, more accurate) and how hard.
  apiThinking: true,
  apiEffort: 'medium',
  timeoutMs: 55000, // hooks are given 60s by the tools
  minSeverity: 2, // 0 none, 1 mild, 2 moderate, 3 severe; act at >= this
  rawPrefix: '[raw]', // messages starting with this are sent as-is
  showErrors: true, // tell the user when a message could not be checked
  // Write each check (message text included) to ~/.decaf/log.jsonl. Off by default;
  // turn on to troubleshoot.
  log: false,

  // Cursor: context (send, attach cleaned-up version, system notification) | block (hold back, show suggestion)
  cursorMode: 'context',
  // What you see: changes | full | both | silent
  display: 'changes',
  // Language of what you see: auto (follow your message; English if unsupported) | en | zh
  language: 'auto',
  // Override any text in src/i18n.js per language, e.g. {"en": {"changeLine": "- {from}  ->  {to}"}}.
  // Placeholders: {level} {kind} {changes} {rewritten} {original}
  templates: {},
  // Note sent to the agent together with your original message. null = the
  // built-in note in the language of your message (src/i18n.js, key "context").
  contextTemplate: null,
};

export function readConfigFile() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH(), 'utf8'));
  } catch {
    return {};
  }
}

// Precedence: env vars > ~/.decaf/config.json > defaults.
export function loadConfig() {
  const file = readConfigFile();
  const cfg = {
    ...DEFAULTS,
    ...file,
    models: { ...DEFAULTS.models, ...(file.models || {}) },
    cursorModelMap: { ...DEFAULTS.cursorModelMap, ...(file.cursorModelMap || {}) },
    openai: { ...DEFAULTS.openai, ...(file.openai || {}) },
  };
  const env = process.env;
  if (env.DECAF_DISABLE === '1') cfg.enabled = false;
  if (env.DECAF_BACKEND) cfg.backend = env.DECAF_BACKEND;
  if (env.DECAF_LOG === '0') cfg.log = false;
  if (env.DECAF_LOG === '1') cfg.log = true;
  return cfg;
}

// decaf config set models.claude opus  ->  writes {"models":{"claude":"opus"}}
export function setConfig(path, value) {
  const file = readConfigFile();
  const keys = path.split('.');
  let o = file;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  let v = value;
  try { v = JSON.parse(value); } catch {}
  o[keys.at(-1)] = v;
  mkdirSync(DECAF_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH(), JSON.stringify(file, null, 2) + '\n');
  return file;
}

// The model a backend should use. For Cursor in 'follow' mode this depends on
// cfg.chatModel, the model the user is chatting with (sent by Cursor's hook).
export function modelFor(cfg, backend) {
  const m = cfg.models[backend];
  if (backend !== 'cursor' || m !== 'follow') return m;
  const chat = String(cfg.chatModel || '').toLowerCase();
  const map = cfg.cursorModelMap || {};
  for (const [k, v] of Object.entries(map)) if (k !== 'default' && chat.includes(k.toLowerCase())) return v;
  return map.default || null;
}
