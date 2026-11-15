# decaf

decaf turns the heat in your messages to a coding agent into plain instructions, before the agent reads them.

When you're frustrated, the message you send to Claude Code, Codex or Cursor often carries sarcasm, rhetorical questions or insults alongside the actual request. The request is still in there, but the agent has to dig it out: "Can you even sort a list?" really means "I want descending order, not ascending."

decaf checks each message as you send it. If it finds wording aimed at the agent that carries no information, it hands the agent a version that says the same thing directly. Your requests, facts, questions and your judgment of the result are kept, including how harsh that judgment is. Quoting or discussing such phrases, direct criticism and genuine questions are left alone.

```
You:   你是不是傻，我说了列表要按日期倒序，你又给我排成正序。改成倒序。
Agent also gets:  我说了列表要按日期倒序，你又给我排成正序。改成倒序。
```

What it's for:

- **Clearer instructions.** The agent gets the request in plain words instead of guessing what a rhetorical question means.
- **Fewer wasted turns.** Less of the agent's reply goes to apologising or defending itself, more to the work.
- **No change to how you talk.** You type as usual; your original message is still sent, you see what was changed, and you can skip the check for any message.

By default decaf uses **the model and login of the tool you already use**: no extra account or API key. If you have an Anthropic API key, [API mode](#api-mode-faster) cuts the wait to about 2 seconds.

## Supported tools

All results below were measured on macOS.

| Tool | Desktop app | CLI | What you see when a message is changed | Extra wait per message (median) |
|---|---|---|---|---|
| Claude Code | ✅ | ✅ interactive and `claude -p` | A notice in the conversation | about 6 s |
| Codex | ✅ | ✅ interactive and `codex exec` | A notice in the conversation and a macOS notification | about 11 s |
| Cursor | ✅ | ✅ interactive; ❌ `agent -p` (Cursor does not run prompt hooks there) | A macOS notification (Cursor shows hook messages only when it blocks) | about 9 s when nothing needs changing, longer when it rewrites |

Every message waits for the check, including ones that need no change. If the check fails or times out, the message is sent as is.

Which model runs the check:

| Tool | Default model | Billing |
|---|---|---|
| Claude Code | Sonnet | Your Claude subscription |
| Codex | `gpt-5.6-luna` | Your Codex login |
| Cursor | `cursor-grok-4.6-low`; if you chat with a GPT or Claude model, a light model of the same family (`gpt-5.3-codex-low`, `claude-sonnet-5-5-low`) | Grok is in Cursor's included usage; GPT and Claude models are billed separately by Cursor |

How well the default models do on our 52-message test set (Chinese messages, each run twice, rewrites graded by Claude Opus):

| Tool / model | Hostile messages caught | Normal messages changed by mistake | Rewrites with nothing hostile left | Key points kept |
|---|---|---|---|---|
| Claude Code / Sonnet | 28/28 | 0/58 | 85% | 98% |
| Codex / gpt-5.6-luna | 28/28 | 0/58 | 82% | 98% |
| Cursor / cursor-grok-4.6-low | 28/28 | 0/58 | 72% | 98% |

English messages were checked on a smaller set (14 made-up messages, each run twice). No normal message, quote or genuine question was changed by mistake on any tool. Codex caught all 12 hostile runs; Claude Code and Cursor caught 10 of 12, both missing a message that opened with a bare "Useless.", which they read as a judgment of the result. All rewrites kept every key point except two in Codex, and one Cursor rewrite left a hostile phrase in.

**Claude Code gives the best experience**: shortest wait, most accurate rewrites, and the notice appears right in the conversation. For the shortest wait in any tool, use API mode.

## API mode (faster)

Instead of going through your tool's CLI, decaf can call the Anthropic API directly with your own API key. It works the same in Claude Code, Codex and Cursor.

| | Default (your tool's login) | API mode |
|---|---|---|
| Extra wait per message (median) | 6–11 s | about 2 s |
| Account | The subscription or plan you already have | An Anthropic API account with credit ([platform.claude.com](https://platform.claude.com)), separate from a Claude subscription |
| Cost | Uses your plan's included usage | About $0.70 per 1,000 messages (Claude Sonnet 5.5, list price, measured on our test set) |

On the same tests, API mode (Claude Sonnet 5.5, adaptive thinking at medium effort) caught 28/28 hostile Chinese messages and 10/12 English ones, changed 2 of 58 normal Chinese messages by mistake (both times the same borderline complaint) and none of the English ones, and left nothing hostile in 86% of Chinese and all English rewrites.

To turn it on:

1. **You**: create an API key at [platform.claude.com](https://platform.claude.com) (API Keys).
2. **You**: run `decaf set-key` in a terminal and paste the key (input is hidden). decaf checks the key with one test request and stores it in `~/.decaf/anthropic-key`, readable only by you. If `ANTHROPIC_API_KEY` is set, decaf uses that instead, but apps opened from the Dock do not see variables from your shell profile, so the saved key is the reliable option.
3. Run `decaf config set backend anthropic`.

To go back: `decaf config set backend auto`. Other settings: `models.anthropic` (default `claude-sonnet-5-5`), `apiThinking` (default `true`), `apiEffort` (default `medium`).

## Requirements

- macOS
- Node.js 18 or later
- The tool you use, logged in. For Cursor, also the Cursor CLI (`agent`), logged in.

## Install

You can hand this section to your agent. Only the steps marked **you** need to be done by you.

### Claude Code

```bash
claude plugin marketplace add JingHYK/decaf
claude plugin install decaf@decaf-marketplace --scope user
```

Claude Code hooks cannot reuse the app's login, so decaf needs a subscription token (skip this if you use [API mode](#api-mode-faster)):

1. **You**: run `claude setup-token` in a terminal, log in in the browser, and copy the token it prints last. The token is a secret; do not paste it to the agent.
2. **You**: run `node ~/.claude/plugins/cache/decaf-marketplace/decaf/<version>/bin/decaf.js set-token` and paste the token. It is stored in `~/.decaf/claude-token`, readable only by you. To revoke it, delete that file.

Then start a new session. The plugin works in both the Claude Code CLI and the desktop app.

If you skip these steps, or the token expires, decaf lets your messages through unchecked and its notice shows the exact command to run, with the real path filled in.

### Codex

The repo is also a Codex plugin. Install it from Codex's plugin browser, or clone it (`git clone https://github.com/JingHYK/decaf.git`) and add this to `~/.codex/config.toml`:

```toml
[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "node /ABSOLUTE/PATH/TO/decaf/bin/decaf.js hook"
timeout = 60
```

Codex runs a new hook only after you approve it: `/hooks` in the CLI, or Settings > Hooks in the desktop app. The approval covers both the CLI and the desktop app.

### Cursor

Install and log in to the Cursor CLI (`agent`) first; decaf uses it to call Cursor's model.

If the Claude Code plugin above is installed, you are done: Cursor (desktop app and interactive CLI) also runs Claude Code plugin hooks. Otherwise, clone the repo, copy `cursor/hooks.json` to `~/.cursor/hooks.json` (or merge it into yours) and fix the path. Doing both is harmless: decaf notices when it runs twice for the same message and checks it only once.

## Using it

- To send one message untouched, start it with `[raw]`.
- To turn decaf off for a while: `decaf config set enabled false`.

## Settings

Everything lives in `~/.decaf/config.json`. Ask your agent to change it, or use the CLI. In the examples, `decaf` stands for `node <decaf folder>/bin/decaf.js`.

```bash
decaf config                            # show settings
decaf config set models.claude opus     # use Opus in Claude Code
decaf config set models.codex <model>   # pick a Codex model
decaf config set models.cursor composer-2.5        # always use one Cursor model
decaf config set cursorModelMap.default grok-4.7-low  # change Cursor's default
decaf config set minSeverity 3          # only act on insults
decaf config set display full           # show the full cleaned-up version in the notice
decaf config set language en            # always show notices in English
```

- `display`: `changes` (before/after for each change, default), `full`, `both`, or `silent`
- `language`: `auto` (follow your message, default), `en`, `zh`. Notices exist in English and Chinese; other languages fall back to English.
- `templates`: override any notice text per language, e.g. `{"en": {"changeLine": "- {from} -> {to}"}}`. Placeholders: `{level}` `{kind}` `{changes}` `{rewritten}` `{original}`. Defaults are in `src/i18n.js`.
- `contextTemplate`: the note attached for the agent
- `cursorMode`: `context` (default: send, attach the cleaned-up version) or `block` (hold the message back and show a suggested version to copy and resend)
- `models.cursor`: `follow` (default) picks from `cursorModelMap` by your Cursor chat model (substring match, first wins; `default` covers the rest)
- `backend`: `auto` (default; use the tool that called the hook), `anthropic` (API mode), or `claude` / `codex` / `cursor`
- `log`: `false` (default). Set to `true` to write each check, message text included, to `~/.decaf/log.jsonl` when troubleshooting.

## Privacy

- **Where your message goes**: to the model of the tool you are using, through that tool's own CLI and login; in API mode, to the Anthropic API with your key. decaf sends it nowhere else.
- **What is stored on your computer**: your settings, the Claude token (Claude Code only) or API key (API mode only), and the result of each check for about 20 minutes (in `~/.decaf/inflight/`, so the same message is not checked twice). Nothing else by default.
- **The tools' own history**: Codex and Claude Code are run in a mode that saves no session. The Cursor CLI always saves a chat; decaf runs it in its own empty workspace and deletes those chats after 5 minutes.

## Limitations

- **The agent still receives your original message.** Claude Code, Codex and Cursor do not let a hook replace a message, only add to it, so decaf attaches the cleaned-up version and tells the agent to work from it. To keep the original from being sent at all, use Cursor with `cursorMode: block`.
- Every message waits for the check (see the table above).
- macOS only for now.
- The check was tuned on Chinese messages. English has been evaluated only on a small set (see above). Other languages have not been evaluated.

## Development

```bash
npm test                                       # logic tests, no model calls (also run by CI)
npm run eval -- --backend claude --runs 2      # run the eval against a real model (uses your subscription)
```

`npm run eval` uses `eval/example-suite.json` (six made-up messages showing the format) unless you pass `--suite your-suite.json` or keep a suite at `eval/private/suite.json`. Results and reports are written to `eval/private/`, which git ignores because they contain message text. Rewrites are graded with the prompt in `eval/grade.md`.

## License

MIT
