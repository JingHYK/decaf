#!/usr/bin/env node
import { runHook } from '../src/hook.js';
import { check } from '../src/check.js';
import { TOKEN_PATH, API_KEY_PATH, OPENAI_KEY_PATH, findClaude, run, callModel } from '../src/backends.js';
import { DECAF_HOME, CONFIG_PATH, loadConfig, setConfig } from '../src/config.js';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';

const HELP = `decaf: before a message reaches your coding agent, spot hostility aimed at the agent and hand the agent a cleaned-up version

Usage:
  decaf check [text]             Rate the message and, if needed, return the cleaned-up version (what the hook runs)
  decaf hook                     Run as a prompt-submit hook (reads stdin; detects Claude Code / Codex / Cursor)
  decaf config                   Show the current settings
  decaf config set <key> <value> Change a setting, e.g. decaf config set models.claude opus
  decaf set-token                Save the subscription token from \`claude setup-token\` (Claude Code only)
  decaf set-key                  Save an Anthropic API key (backend: anthropic)
  decaf set-key openai           Save a key for an OpenAI-compatible API (backend: openai)

Settings file: ~/.decaf/config.json`;

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

// Read one line from the terminal without echoing it.
function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl-C
        if (ch === '\u007f') buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

async function setToken() {
  const token = (process.stdin.isTTY
    ? await promptHidden('Paste the token printed by `claude setup-token` (starts with sk-ant-oat; input is hidden), then press Enter: ')
    : await readStdin()
  ).replace(/\s+/g, '');
  if (!/^sk-ant-oat\d*-[A-Za-z0-9_-]{20,}$/.test(token)) {
    console.error(`That is not a Claude subscription token (length ${token.length}; it should start with sk-ant-oat01-). Nothing was saved.\nRun claude setup-token, finish the browser login, copy the token from the last line it prints, and try again.`);
    process.exit(1);
  }
  mkdirSync(DECAF_HOME, { recursive: true });
  writeFileSync(TOKEN_PATH(), token + '\n', { mode: 0o600 });
  chmodSync(TOKEN_PATH(), 0o600);
  console.log(`Saved to ${TOKEN_PATH()} (length ${token.length})`);
  const bin = findClaude();
  if (!bin) return console.log('Could not find the claude CLI, so the token was not verified.');
  process.stdout.write('Verifying the token with a test request…');
  try {
    await run(bin, ['-p', '--model', 'haiku', '--no-session-persistence', '--settings', '{"disableAllHooks": true}'], {
      input: 'Reply with exactly: OK',
      timeoutMs: 60000,
      env: { CLAUDE_CODE_OAUTH_TOKEN: token },
    });
    console.log(' ✔ Token works.');
  } catch (e) {
    console.log(` ✘ Verification failed: ${e.message.split('\n').pop()}`);
    console.log('Common cause: the terminal wrapped the token across lines and only part was copied. Widen the terminal window and run claude setup-token again.');
    process.exit(1);
  }
}

// decaf set-key            -> Anthropic API key (backend: anthropic)
// decaf set-key openai     -> key for the OpenAI-compatible API in openai.baseUrl (backend: openai)
async function setKey(provider) {
  const openai = provider === 'openai';
  if (provider && !openai) {
    console.error(`Unknown provider "${provider}". Use: decaf set-key (Anthropic) or decaf set-key openai`);
    process.exit(1);
  }
  const name = openai ? 'API key for your OpenAI-compatible provider' : 'Anthropic API key';
  const key = (process.stdin.isTTY ? await promptHidden(`Paste your ${name} (input is hidden), then press Enter: `) : await readStdin()).replace(/\s+/g, '');
  const ok = openai ? key.length >= 20 : /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key);
  if (!ok) {
    console.error(`That does not look like an ${name} (length ${key.length}${openai ? '' : '; it should start with sk-ant-'}). Nothing was saved.`);
    process.exit(1);
  }
  const path = openai ? OPENAI_KEY_PATH() : API_KEY_PATH();
  const envVar = openai ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
  const backend = openai ? 'openai' : 'anthropic';
  mkdirSync(DECAF_HOME, { recursive: true });
  writeFileSync(path, key + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
  console.log(`Saved to ${path} (length ${key.length})`);
  const cfg = loadConfig();
  process.stdout.write(`Verifying the key with a test request${openai ? ` to ${cfg.openai.baseUrl} (model ${cfg.openai.model})` : ''}…`);
  const saved = process.env[envVar];
  delete process.env[envVar]; // test the saved key, not one from the shell
  try {
    await callModel(backend, 'Reply with exactly: OK', 'OK?', { ...cfg, timeoutMs: 60000 });
    console.log(' ✔ Key works.');
    if (cfg.backend !== backend) console.log(`To use it, run: decaf config set backend ${backend}`);
  } catch (e) {
    console.log(` ✘ Verification failed: ${e.message}`);
    process.exit(1);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved;
  }
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'check') {
    const text = args.join(' ') || (await readStdin());
    console.log(JSON.stringify(await check(text), null, 2));
  } else if (cmd === 'hook') {
    // Never break the user's prompt: on any error, exit 0 and let it through.
    try {
      const raw = await readStdin();
      const out = await runHook(raw ? JSON.parse(raw) : {});
      if (out) process.stdout.write(JSON.stringify(out));
    } catch (e) {
      process.stderr.write(`decaf: ${e.message}\n`);
    }
    process.exit(0);
  } else if (cmd === 'config') {
    if (args[0] === 'set' && args.length >= 3) {
      setConfig(args[1], args.slice(2).join(' '));
      console.log(`Saved to ${CONFIG_PATH()}`);
    }
    console.log(JSON.stringify(loadConfig(), null, 2));
  } else if (cmd === 'set-token') {
    await setToken();
  } else if (cmd === 'set-key') {
    await setKey(args[0]);
  } else {
    console.log(HELP);
  }
}

main();
