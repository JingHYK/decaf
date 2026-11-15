// Logic tests with a canned model reply. They do not test whether the model judges correctly;
// that is what eval/ is for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.DECAF_HOME = mkdtempSync(join(tmpdir(), 'decaf-test-'));
const { runHook, detectHost } = await import('../src/hook.js');
const { parseCheck } = await import('../src/check.js');
const { loadConfig, setConfig, modelFor, DEFAULTS } = await import('../src/config.js');
const { pickBackend, cleanCursorChats } = await import('../src/backends.js');
const { detectLang } = await import('../src/i18n.js');

const cfg = (over = {}) => ({ ...loadConfig(), minSeverity: 2, models: { claude: 'sonnet', codex: null, cursor: null }, log: false, ...over });
const mock = (o) => (process.env.DECAF_MOCK_RESPONSE = typeof o === 'string' ? o : JSON.stringify(o));
const unmock = () => delete process.env.DECAF_MOCK_RESPONSE;
const hostile = { severity: 3, kind: 'insult', rewritten: '我要的是倒序，不是正序。', changes: [{ from: '你是猪吗，', to: '' }] };
const P = '你是猪吗，我要的是倒序，不是正序。';

test('severity below threshold: no output (Claude Code/Codex), continue (Cursor)', async () => {
  mock({ severity: 1 });
  assert.equal(await runHook({ prompt: '行吧，加个单元测试' }, { cfg: cfg() }), null);
  assert.deepEqual(await runHook({ prompt: '行吧', cursor_version: '2.0' }, { cfg: cfg() }), { continue: true });
  unmock();
});

test('Claude Code / Codex: cleaned version goes to the agent, without extra instructions', async () => {
  mock(hostile);
  const out = await runHook({ prompt: P }, { cfg: cfg() });
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /^下面是用户这条消息去掉敌意措辞后的版本/);
  assert.match(ctx, /<message>\n我要的是倒序，不是正序。\n<\/message>/);
  assert.doesNotMatch(ctx, /道歉|整理后的需求|情绪/);
  assert.equal(out.systemMessage, 'decaf · 重度 · 骂人\nagent 收到的是整理版，改动如下：\n原：你是猪吗，\n改：（删去）');
  unmock();
});

test('Cursor: sends with context by default; block mode shows the suggestion', async () => {
  mock(hostile);
  const ctx = await runHook({ prompt: P, cursor_version: '2.0' }, { cfg: cfg({ display: 'silent' }) });
  assert.equal(ctx.continue, true);
  assert.match(ctx.additional_context, /<message>\n我要的是倒序，不是正序。/);
  const out = await runHook({ prompt: P, cursor_version: '2.0' }, { cfg: cfg({ cursorMode: 'block' }) });
  assert.equal(out.continue, false);
  assert.match(out.user_message, /建议改为（可复制后重发）：\n\n我要的是倒序，不是正序。/);
  unmock();
});

test('display modes and custom template', async () => {
  mock(hostile);
  const p = { prompt: P };
  assert.match((await runHook(p, { cfg: cfg({ display: 'full' }) })).systemMessage, /整理版：\n我要的是倒序/);
  assert.equal((await runHook(p, { cfg: cfg({ language: 'en' }) })).systemMessage.split('\n')[0], 'decaf · severe · insult');
  assert.equal((await runHook(p, { cfg: cfg({ display: 'silent' }) })).systemMessage, undefined);
  assert.equal((await runHook(p, { cfg: cfg({ messageTemplate: '[{level}] {rewritten}' }) })).systemMessage, '[重度] 我要的是倒序，不是正序。');
  unmock();
});

test('model failure never blocks', async () => {
  mock('not json');
  const out = await runHook({ prompt: '你是猪吗' }, { cfg: cfg() });
  assert.match(out.systemMessage, /未检查/);
  assert.equal(out.hookSpecificOutput, undefined);
  assert.equal(await runHook({ prompt: '你是猪吗' }, { cfg: cfg({ showErrors: false }) }), null);
  assert.deepEqual(await runHook({ prompt: '你是猪吗', cursor_version: '2.0' }, { cfg: cfg() }), { continue: true });
  unmock();
});

test('skipped for slash commands, [raw] prefix, and nested calls', async () => {
  mock(hostile);
  assert.equal(await runHook({ prompt: '/help 你是猪吗' }, { cfg: cfg() }), null);
  assert.equal(await runHook({ prompt: '[raw] 你是猪吗' }, { cfg: cfg() }), null);
  assert.equal(await runHook({ prompt: '<task-notification> 你是猪吗' }, { cfg: cfg() }), null);
  process.env.DECAF_INNER = '1';
  assert.equal(await runHook({ prompt: '你是猪吗' }, { cfg: cfg() }), null);
  delete process.env.DECAF_INNER;
  unmock();
});

test('host detection and default backend follow the calling tool', () => {
  assert.equal(detectHost({ prompt: 'x', session_id: 's' }), 'claude-code');
  assert.equal(detectHost({ prompt: 'x', turn_id: 't' }), 'codex');
  assert.equal(detectHost({ prompt: 'x', cursor_version: '2' }), 'cursor');
  assert.equal(pickBackend(cfg(), 'codex'), 'codex');
  assert.equal(pickBackend(cfg(), 'cursor'), 'cursor');
  assert.equal(pickBackend(cfg({ backend: 'claude' }), 'cursor'), 'claude');
});

test('config set writes nested keys', () => {
  setConfig('models.claude', 'opus');
  setConfig('minSeverity', '3');
  const c = loadConfig();
  assert.equal(c.models.claude, 'opus');
  assert.equal(c.models.codex, 'gpt-5.6-luna');
  assert.equal(c.minSeverity, 3);
});

test('Cursor model follows the chat model family; explicit model overrides', () => {
  const c = { ...DEFAULTS, cursorModelMap: { ...DEFAULTS.cursorModelMap } };
  const pick = (chatModel, extra = {}) => modelFor({ ...c, ...extra, chatModel }, 'cursor');
  assert.equal(pick('grok-4.7-high-fast'), 'cursor-grok-4.6-low');
  assert.equal(pick('gpt-5.3-codex-xhigh'), 'gpt-5.3-codex-low');
  assert.equal(pick('gpt-5.6-sol-high'), 'gpt-5.3-codex-low');
  assert.equal(pick('claude-opus-5-5-max'), 'claude-sonnet-5-5-low');
  assert.equal(pick('composer-2.5'), 'cursor-grok-4.6-low');
  assert.equal(pick('default'), 'cursor-grok-4.6-low');
  assert.equal(pick(undefined), 'cursor-grok-4.6-low');
  assert.equal(pick('grok-4.7', { models: { ...c.models, cursor: 'gpt-5.3-codex-low' } }), 'gpt-5.3-codex-low');
  assert.equal(modelFor({ ...c, chatModel: 'grok-4.7' }, 'claude'), 'sonnet');
});

test('parseCheck ignores text after the first JSON object', () => {
  assert.equal(parseCheck('{"severity": 2, "rewritten": "a {b}"}\n{"x":1}').rewritten, 'a {b}');
});

test('UI language follows the message; English is the default and fallback', async () => {
  assert.equal(detectLang('你到底会不会写测试？跑一下 npm test'), 'zh');
  assert.equal(detectLang('Are you kidding me? revert db/migrations'), 'en');
  assert.equal(detectLang('看下 config.ts'), 'zh');
  assert.equal(detectLang('なんでテストが落ちるの'), 'en');
  mock({ severity: 2, kind: 'rhetorical', rewritten: 'I asked you not to touch migrations.', changes: [{ from: 'Are you kidding me?', to: '' }] });
  const out = await runHook({ prompt: 'Are you kidding me? I asked you not to touch migrations.' }, { cfg: cfg() });
  assert.equal(out.systemMessage, 'decaf · moderate · rhetorical put-down\nThe agent received a cleaned-up version. Changes:\nBefore: Are you kidding me?\nAfter: (removed)');
  assert.match(out.hookSpecificOutput.additionalContext, /^Below is the user's message/);
  mock('not json');
  assert.match((await runHook({ prompt: 'Are you kidding me?' }, { cfg: cfg() })).systemMessage, /^decaf · Not checked/);
  unmock();
});

test('per-language template override', async () => {
  mock(hostile);
  const out = await runHook({ prompt: P }, { cfg: cfg({ templates: { zh: { changeLine: '- {from} => {to}' } } }) });
  assert.match(out.systemMessage, /- 你是猪吗， => （删去）/);
  unmock();
});

test('duplicate hook runs for one message call the model once and share the result', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const logPath = join(process.env.DECAF_HOME, 'log.jsonl');
  const before = existsSync(logPath) ? readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length : 0;
  mock(hostile);
  const input = { prompt: '重复测试：你是猪吗，我要倒序', conversation_id: 'c1', cursor_version: '2' };
  const outs = await Promise.all([1, 2, 3].map(() => runHook(input, { cfg: cfg({ log: true, display: 'silent' }) })));
  const after = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length;
  assert.equal(after - before, 1);
  for (const o of outs) assert.equal(o.additional_context, outs[0].additional_context);
  unmock();
});

test('the log is off unless turned on', () => {
  assert.equal(DEFAULTS.log, false);
});

test('Cursor chats left by decaf checks are removed once they are a few minutes old', async () => {
  const { mkdirSync, writeFileSync, utimesSync, readdirSync } = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const home = mkdtempSync(join(tmpdir(), 'decaf-home-'));
  const ws = '/Users/x/.decaf/cursor-workspace';
  const chats = join(home, '.cursor', 'chats', createHash('md5').update(ws).digest('hex'));
  const transcripts = join(home, '.cursor', 'projects', 'Users-x-decaf-cursor-workspace', 'agent-transcripts');
  const other = join(home, '.cursor', 'chats', 'someone-elses-workspace', 'chat1');
  const old = (Date.now() - 10 * 60 * 1000) / 1000;
  for (const d of [join(chats, 'old'), join(chats, 'new'), join(transcripts, 'old'), other]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, 'store.db'), 'x');
  }
  for (const d of [join(chats, 'old'), join(transcripts, 'old'), other]) utimesSync(d, old, old);
  assert.equal(cleanCursorChats(ws, home), 2);
  assert.deepEqual(readdirSync(chats), ['new']);
  assert.deepEqual(readdirSync(transcripts), []);
  assert.deepEqual(readdirSync(join(home, '.cursor', 'chats', 'someone-elses-workspace')), ['chat1']);
});

test('Claude login failure: the notice gives the exact set-token command', async () => {
  const { writeFileSync, chmodSync } = await import('node:fs');
  const { SET_TOKEN_CMD } = await import('../src/backends.js');
  const fake = join(process.env.DECAF_HOME, 'fake-claude');
  writeFileSync(fake, '#!/bin/sh\necho "Failed to authenticate: OAuth session expired" >&2\nexit 1\n');
  chmodSync(fake, 0o755);
  process.env.DECAF_CLAUDE_BIN = fake;
  const out = await runHook({ prompt: '把按钮改成蓝色' }, { cfg: cfg() });
  delete process.env.DECAF_CLAUDE_BIN;
  assert.match(out.systemMessage, /^decaf · 本条未检查：decaf 无法登录 Claude/);
  assert.ok(out.systemMessage.includes(SET_TOKEN_CMD));
  assert.match(SET_TOKEN_CMD, /^node ".*\/bin\/decaf\.js" set-token$/);
});

test('API mode: missing key gives the exact set-key command; low-latency params per model', async () => {
  const { SET_KEY_CMD, apiParams } = await import('../src/backends.js');
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const out = await runHook({ prompt: '把按钮改成蓝色' }, { cfg: cfg({ backend: 'anthropic' }) });
  if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  assert.match(out.systemMessage, /^decaf · 本条未检查：没有可用的 Anthropic API key/);
  assert.ok(out.systemMessage.includes(SET_KEY_CMD));
  assert.deepEqual(apiParams('claude-sonnet-5-5'), { output_config: { effort: 'medium' } });
  const off = { apiThinking: false, apiEffort: 'low' };
  assert.deepEqual(apiParams('claude-haiku-5-5', off), { thinking: { type: 'disabled' }, output_config: { effort: 'low' } });
  assert.deepEqual(apiParams('claude-sonnet-5-5', off), { thinking: { type: 'between_tools' }, output_config: { effort: 'low' } });
  assert.deepEqual(apiParams('claude-opus-5-5', off), { output_config: { effort: 'low' } });
});

test('OpenAI-compatible API: missing or rejected key names set-key openai; request sends no temperature', async () => {
  const { createServer } = await import('node:http');
  const { SET_KEY_CMD } = await import('../src/backends.js');
  const saved = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const oai = (baseUrl) => cfg({ backend: 'openai', openai: { baseUrl, model: 'm', reasoningEffort: 'none' } });

  const noKey = await runHook({ prompt: 'Make the button blue.' }, { cfg: oai('https://api.example.invalid/v1') });
  assert.match(noKey.systemMessage, /^decaf · Not checked: no working OpenAI-compatible API key/);
  assert.ok(noKey.systemMessage.includes(`${SET_KEY_CMD} openai`));

  let body;
  const server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      body = JSON.parse(b);
      if (req.headers.authorization !== 'Bearer good-key-0123456789abcdef') { res.writeHead(401); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '<think>x</think>' + JSON.stringify(hostile) } }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    process.env.OPENAI_API_KEY = 'bad-key-0123456789abcdef';
    const bad = await runHook({ prompt: 'Make the header red.' }, { cfg: oai(url) });
    assert.match(bad.systemMessage, /OpenAI-compatible API key/);
    assert.equal(body.model, 'm'); // the request really reached the server
    process.env.OPENAI_API_KEY = 'good-key-0123456789abcdef';
    const good = await runHook({ prompt: P }, { cfg: oai(url) });
    assert.match(good.hookSpecificOutput.additionalContext, /我要的是倒序，不是正序。/);
    assert.equal('temperature' in body, false);
    assert.equal(body.reasoning_effort, 'none');
  } finally {
    server.close();
    if (saved !== undefined) process.env.OPENAI_API_KEY = saved; else delete process.env.OPENAI_API_KEY;
  }
});
