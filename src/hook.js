// Prompt-submit hook for Claude Code, Codex and Cursor.
//
// Claude Code / Codex (UserPromptSubmit): the prompt cannot be replaced, so we let
// it through and attach
//   additionalContext -> sent to the agent together with the original message
//   systemMessage     -> shown to the user only
// Cursor (beforeSubmitPrompt): the desktop app shows user_message when it blocks.
// In context mode we let the message through and show a system notification.
// Codex accepts systemMessage in the hook protocol, but some Codex clients do not
// surface UserPromptSubmit systemMessage as a visible notification, so we also
// show the same native notification for Codex.
import { check } from './check.js';
import { loadConfig } from './config.js';
import { strings } from './i18n.js';
import { notify } from './notify.js';
import { once, messageKey } from './once.js';
import { SET_TOKEN_CMD, SET_KEY_CMD } from './backends.js';

const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// Each host sends different fields; use them to tell which one called us.
export function detectHost(input) {
  if (input?.cursor_version || input?.hook_event_name === 'beforeSubmitPrompt') return 'cursor';
  if (input?.turn_id !== undefined) return 'codex';
  return 'claude-code';
}

export function vars(r, original, S) {
  const changes = r.changes
    .map((c) => S.changeLine.replace('{from}', c.from).replace('{to}', c.to || S.removed))
    .join('\n');
  return {
    level: S.level[r.severity] || String(r.severity),
    kind: S.kind[r.kind] || r.kind,
    changes,
    rewritten: r.rewritten,
    original,
  };
}

export async function runHook(input, { cfg = loadConfig(), host = detectHost(input) } = {}) {
  const pass = host === 'cursor' ? { continue: true } : null;
  if (!cfg.enabled || process.env.DECAF_INNER === '1') return pass;
  const prompt = String(input?.prompt || '');
  const t = prompt.trim();
  if (!t || t.startsWith('/') || t.startsWith(cfg.rawPrefix)) return pass;
  // Messages the tool itself injects (background-task notices etc.), not typed by the user.
  if (/^<(task-notification|system-reminder|side-sessions-event|ci-monitor-event|local-command)/.test(t)) return pass;

  // Cursor sends the chat model; decaf picks a lighter model from the same family (see cursorModelMap).
  if (input?.model) cfg = { ...cfg, chatModel: String(input.model) };
  const S = strings(cfg, prompt);
  const r = await once(messageKey(input), { waitMs: cfg.timeoutMs, fn: () => check(prompt, { cfg, host }), ok: (x) => x.action !== 'error' });
  if (r.action === 'error') {
    if (!cfg.showErrors || host === 'cursor') return pass; // Cursor shows messages only when blocking
    if (r.code === 'NO_TOKEN') return { systemMessage: fill(S.noToken, { cmd: SET_TOKEN_CMD }) };
    if (r.code === 'NO_API_KEY') return { systemMessage: fill(S.noApiKey, { cmd: r.cmd || SET_KEY_CMD, provider: r.provider || 'Anthropic' }) };
    return { systemMessage: fill(S.error, { error: r.error.slice(0, 80) }) };
  }
  if (r.action !== 'rewrite') return pass;

  const v = vars(r, prompt, S);
  const additional_context = fill(cfg.contextTemplate || S.context, v);
  if (host === 'cursor') {
    if (cfg.cursorMode === 'block') return { continue: false, user_message: fill(S.cursorBlock, v) };
    if (cfg.display !== 'silent') notify(fill(S.notifyTitle, v), r.changes.map((c) => `${c.from} → ${c.to || S.removed}`).join('\n'));
    return { continue: true, additional_context };
  }

  const tpl = cfg.messageTemplate || S[cfg.display];
  if (host === 'codex' && cfg.display !== 'silent') {
    notify(fill(S.notifyTitle, v), r.changes.map((c) => `${c.from} → ${c.to || S.removed}`).join('\n'));
  }
  return {
    ...(cfg.display !== 'silent' && tpl ? { systemMessage: fill(tpl, v) } : {}),
    hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: additional_context },
  };
}
