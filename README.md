# decaf

decaf turns the heat in your messages to a coding agent into plain instructions, before the agent reads them.

When you're frustrated, the message you send to Claude Code, Codex or Cursor often carries insults, sarcasm or venting alongside the actual request. The request is still in there, but the agent has to dig it out, and part of its reply tends to go to apologising instead of the work.

decaf checks each message as you send it. If it finds wording aimed at the agent that carries no information, it hands the agent a version that says the same thing directly:

| Kind | You type | The agent also gets |
|---|---|---|
| Insult | Are you an idiot? I said sort by date descending, not ascending. Fix it. | I said sort by date descending, not ascending. Fix it. |
| Sarcasm | Great job genius, you deleted the migrations folder. Restore it from git and don't touch db/ again. | You deleted the migrations folder. Restore it from git and don't touch db/ again. |
| Rhetorical put-down | Do you actually know how to read a stack trace? The error is on line 42 of auth.ts, not in the router. Look there. | The error is on line 42 of auth.ts, not in the router. Look there. |
| Venting | Are you wasting my time again? I've told you so many times that dates are stored in UTC. Can you even read? Aren't you listening to me at all? Why can't you just remember? Convert to local time only when you display them. | You're wasting my time again. I've told you so many times that dates are stored in UTC. I need you to remember that. Convert to local time only when you display them. |

Your requests, facts, questions and your judgment of the result are kept, including how harsh that judgment is. These are left alone:

- Criticism of the work: *This function is a mess. Three levels of nested ifs is unreadable. Split it into smaller functions.*
- A genuine question: *Have you actually run the tests after that change?*
- Quoting a phrase: *The string "you're useless" shows up in our test fixtures. Move it into fixtures/hostile.txt.*

The cleaned-up version stays in the language you wrote in.

What it's for:

- **Clearer instructions.** The agent gets the request in plain words instead of guessing what a rhetorical question means.
- **Fewer wasted turns.** Less of the agent's reply goes to apologising or defending itself, more to the work.
- **No change to how you talk.** You type as usual; your original message is still sent, you see what was changed, and you can skip the check for any message.

## How it works when you use it

1. You send a message as usual. decaf checks it before the agent starts; every message waits for the check, including ones that need no change.
2. If nothing needs changing, the message goes through untouched.
3. If something does, the agent receives your original message plus the cleaned-up version, with a note to work from the cleaned-up one. You are shown what was changed (see the table under [Install](#install) for where it appears in each tool).
4. If the check fails or times out, the message is sent as is.

To send one message untouched, start it with `[raw]`. To turn decaf off for a while, run `decaf config set enabled false` (`decaf` means `node <decaf folder>/bin/decaf.js`; see [Install](#install) for where the folder is).

## Choose a mode

| | Default | API mode |
|---|---|---|
| What runs the check | The model and login of the tool you already use | Claude (Anthropic API) or GPT (OpenAI API), with your own key |
| Extra account | None | An Anthropic or OpenAI API account with credit, separate from a Claude or ChatGPT subscription |
| Extra wait per message (median) | 6–11 s, depending on the tool | about 2–3 s in every tool |
| Cost | Your plan's included usage | About $0.70 (Claude) or $0.50 (GPT) per 1,000 messages at list price |
| Setup | Install only (Claude Code also needs a token, see [Install](#claude-code)) | Install, then the steps under [API mode](#api-mode) |

### Default mode

Which model runs the check:

- **Claude Code**: Claude Sonnet 5.5, on your Claude subscription. decaf asks for `sonnet`, which Claude Code maps to its current Sonnet model.
- **Codex**: `gpt-5.6-luna`, on your Codex login.
- **Cursor**: Grok 4.6 Low (`cursor-grok-4.6-low`), which is in Cursor's included usage. If your chat uses a GPT or Claude model, decaf uses a light model of the same family instead (`gpt-5.3-codex-low` or `claude-sonnet-5-5-low`), which Cursor bills separately.

### API mode

Instead of going through your tool, decaf calls a model API directly with your own key. It works the same in Claude Code, Codex and Cursor. Two providers are tested:

| | Anthropic | OpenAI |
|---|---|---|
| Model | Claude Sonnet 5.5 | GPT-5.6 Luna, low reasoning effort |
| Get a key | [Claude Console](https://platform.claude.com) | [OpenAI Platform](https://platform.openai.com/api-keys) |
| Save the key | `decaf set-key` | `decaf set-key openai` |
| Turn it on | `decaf config set backend anthropic` | `decaf config set backend openai` |

1. **You**: create an API key with the provider (the account needs credit).
2. **You**: run the `set-key` command in a terminal and paste the key (input is hidden). decaf checks the key with one test request and stores it in `~/.decaf/`, readable only by you. If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, decaf uses that instead, but apps opened from the Dock do not see variables from your shell profile, so the saved key is the reliable option.
3. Run the `config set backend` command.

To go back: `decaf config set backend auto`.

Other settings:

- Anthropic: `models.anthropic` (default `claude-sonnet-5-5`), `apiThinking` (default `true`), `apiEffort` (default `medium`).
- OpenAI: `openai.model` (default `gpt-5.6-luna`), `openai.reasoningEffort` (default `low`), `openai.baseUrl` (default `https://api.openai.com/v1`). Another provider with an OpenAI-compatible API can be used by changing `openai.baseUrl` and `openai.model`; we have only tested OpenAI.

### How well it works

We tested decaf on 14 English and 52 Chinese messages, a mix of hostile ones and ones that should be left alone (criticism of the work, quoted phrases, genuine questions, normal requests). Each message was checked twice in every mode, and the rewrites were reviewed by a second model. In default mode in all three tools, and in API mode with both providers:

- **Hostile messages** were caught every time in Chinese and in 10 to 12 of 12 runs in English, depending on the tool.
- **Messages that should be left alone** were almost never changed: no mistakes in default mode, and in API mode the same borderline complaint in the Chinese set with both providers.
- **Rewrites** kept the request and facts in almost every case. Most removed all the hostile wording; the rest left some in.

## Install

Requirements: macOS, Node.js 18 or later, and the tool you use, logged in.

You can hand this section to your agent. Only the steps marked **you** need to be done by you. In the commands, `decaf` stands for `node <decaf folder>/bin/decaf.js`, where the decaf folder is `~/.claude/plugins/cache/decaf-marketplace/decaf/<version>` for the Claude Code plugin, `~/.codex/plugins/cache/decaf-marketplace/decaf/<version>` for the Codex plugin, or your clone of the repo.

All results below were measured on macOS.

| Tool | Desktop app | CLI | What you see when a message is changed | Extra wait per message, default mode (median) |
|---|---|---|---|---|
| Claude Code | ✅ | ✅ interactive and `claude -p` | A notice in the conversation | about 6 s |
| Codex | ✅ | ✅ interactive and `codex exec` | A macOS notification | about 11 s |
| Cursor | ✅ | ✅ interactive (`agent`); ❌ one-shot `agent -p`, which Cursor runs without prompt hooks (checked with Cursor CLI 2026.11.11) | A macOS notification (Cursor shows a hook's message in the chat only when the hook blocks the message, see `cursorMode`) | about 9 s when nothing needs changing, longer when it rewrites |

### Claude Code

```bash
claude plugin marketplace add JingHYK/decaf
claude plugin install decaf@decaf-marketplace --scope user
```

Claude Code hooks cannot reuse the app's login, so in default mode decaf needs a subscription token (skip this in [API mode](#api-mode)):

1. **You**: run `claude setup-token` in a terminal, log in in the browser, and copy the token it prints last. The token is a secret; do not paste it to the agent.
2. **You**: run `node ~/.claude/plugins/cache/decaf-marketplace/decaf/<version>/bin/decaf.js set-token` and paste the token. It is stored in `~/.decaf/claude-token`, readable only by you. To revoke it, delete that file.

Then start a new session. The plugin works in both the Claude Code CLI and the desktop app.

If you skip these steps, or the token expires, decaf lets your messages through unchecked and its notice shows the exact command to run, with the real path filled in.

### Codex

```bash
codex plugin marketplace add JingHYK/decaf
codex plugin add decaf@decaf-marketplace
```

Or clone the repo (`git clone https://github.com/JingHYK/decaf.git`) and add this to `~/.codex/config.toml`:

```toml
[[hooks.UserPromptSubmit]]
[[hooks.UserPromptSubmit.hooks]]
type = "command"
command = "node /ABSOLUTE/PATH/TO/decaf/bin/decaf.js hook"
timeout = 60
```

**You**: approve the hook. Codex runs a new hook only after you approve it: `/hooks` in the CLI, or Settings > Hooks in the desktop app. The approval covers both the CLI and the desktop app.

### Cursor

In default mode decaf calls Cursor's model through the Cursor CLI (`agent`), so install it and log in first. In API mode you don't need it.

- **If you also use Claude Code**: install the Claude Code plugin above. The Cursor desktop app runs Claude Code plugin hooks, so decaf works there with nothing else to set up.
- **Otherwise, or to use it in the Cursor CLI**: clone the repo, copy `cursor/hooks.json` to `~/.cursor/hooks.json` (merge it if you already have one) and change the path to your clone. Both the desktop app and the CLI run hooks from this file.

Cursor runs these hooks without asking you to approve them. If you set up both, Cursor runs decaf twice for each message; decaf notices and checks it only once.

## Updating

- **Claude Code**: `claude plugin marketplace update decaf-marketplace`, then `claude plugin update decaf@decaf-marketplace`, then start a new session.
- **Codex**: `codex plugin marketplace upgrade decaf-marketplace`, then `codex plugin add decaf@decaf-marketplace`, then **approve the hook again** (`/hooks` in the CLI, or Settings > Hooks). Codex does not run a hook whose plugin changed until you approve it, so until then your messages go through unchecked.
- **Cursor with `~/.cursor/hooks.json`**: `git pull` in your clone. With the Claude Code plugin, update it as above.

## Settings

Everything lives in `~/.decaf/config.json`. Ask your agent to change it, or use the CLI:

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

- `backend`: `auto` (default; use the tool that called the hook), `anthropic` or `openai` (API mode), or `claude` / `codex` / `cursor`
- `display`: `changes` (before/after for each change, default), `full`, `both`, or `silent`
- `language`: `auto` (follow your message, default), `en`, `zh`. Notices exist in English and Chinese; other languages fall back to English.
- `templates`: override any notice text per language, e.g. `{"en": {"changeLine": "- {from} -> {to}"}}`. Placeholders: `{level}` `{kind}` `{changes}` `{rewritten}` `{original}`. Defaults are in `src/i18n.js`.
- `contextTemplate`: replace the note attached for the agent (default: a built-in note in the language of your message)
- `cursorMode`: `context` (default: send, attach the cleaned-up version) or `block` (hold the message back and show a suggested version to copy and resend)
- `models.cursor`: `follow` (default) picks from `cursorModelMap` by your Cursor chat model (substring match, first wins; `default` covers the rest)
- `log`: `false` (default). Set to `true` to write each check, message text included, to `~/.decaf/log.jsonl` when troubleshooting.

## Privacy

- **Where your message goes**: to the model of the tool you are using, through that tool's own CLI and login; in API mode, to the Anthropic or OpenAI API with your key. decaf sends it nowhere else.
- **What is stored on your computer**: your settings, the Claude token (Claude Code in default mode only) or API keys (API mode only), and the result of each check, including the cleaned-up text, for about 20 minutes (in `~/.decaf/inflight/`, so the same message is not checked twice). Nothing else by default.
- **The tools' own history**: Codex and Claude Code are run in a mode that saves no session. The Cursor CLI always saves a chat; decaf runs it in its own empty workspace and deletes those chats after 5 minutes.

## Limitations

- **The agent still receives your original message.** Claude Code, Codex and Cursor do not let a hook replace a message, only add to it, so decaf attaches the cleaned-up version and tells the agent to work from it. To keep the original from being sent at all, use Cursor with `cursorMode: block`.
- Every message waits for the check (see [Choose a mode](#choose-a-mode)).
- macOS only for now.
- Tested in English and Chinese only (see [How well it works](#how-well-it-works)). Other languages have not been tested.

## Development

```bash
npm test                                       # logic tests, no model calls (also run by CI)
npm run eval -- --backend claude --runs 2      # run the eval against a real model (uses your subscription)
```

`npm run eval` uses `eval/example-suite.json` (six made-up English messages showing the format) unless you pass `--suite your-suite.json` or keep a suite at `eval/private/suite.json`. Results and reports are written to `eval/private/`, which git ignores because they contain message text. Rewrites are graded with the prompt in `eval/grade.md`.

## License

MIT
