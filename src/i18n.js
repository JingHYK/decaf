// User-facing text. English is the default and the fallback; Chinese is used
// when the user's message is written in Chinese. Add a language by adding a block.
export const STRINGS = {
  en: {
    level: { 2: 'moderate', 3: 'severe' },
    kind: { insult: 'insult', belittle: 'belittling', sarcasm: 'sarcasm', rhetorical: 'rhetorical put-down' },
    removed: '(removed)',
    context:
      "Below is the user's message with the hostile wording removed. Use this version to understand and act on the request. Do not mention this note in your reply, and do not let it change the language you reply in.\n<message>\n{rewritten}\n</message>",
    changeLine: 'Before: {from}\nAfter: {to}',
    changes: 'decaf · {level} · {kind}\nThe agent received a cleaned-up version. Changes:\n\n{changes}',
    full: 'decaf · {level} · {kind}\nThe agent received this cleaned-up version:\n\n{rewritten}',
    both: 'decaf · {level} · {kind}\nThe agent received a cleaned-up version. Changes:\n\n{changes}\n\nFull version:\n\n{rewritten}',
    cursorBlock:
      'decaf · {level} · {kind} · Not sent\n\nSuggested version (copy and resend):\n\n{rewritten}\n\nChanges:\n\n{changes}\n\nTo send a message as-is, start it with [raw].',
    error: 'decaf · Not checked ({error}). Sent as-is.',
    noApiKey:
      'decaf · Not checked: no working {provider} API key. Sent as-is.\nTo fix, run this in a terminal (not in this chat) and paste your key:\n{cmd}',
    noToken:
      'decaf · Not checked: decaf cannot log in to Claude. Sent as-is.\nTo fix, run these in a terminal (not in this chat):\n1. claude setup-token\n2. {cmd}\nand paste the token that step 1 prints last.',
    notifyTitle: 'decaf · {level} · {kind} · agent got a cleaned-up version',
  },
  zh: {
    level: { 2: '中度', 3: '重度' },
    kind: { insult: '骂人', belittle: '贬低', sarcasm: '嘲讽', rhetorical: '反问否定' },
    removed: '（删去）',
    context:
      '下面是用户这条消息去掉敌意措辞后的版本。请按这个版本理解并执行请求，回复时不要提到这条说明，也不要因为这条说明改变回复语言。\n<message>\n{rewritten}\n</message>',
    changeLine: '原：{from}\n改：{to}',
    changes: 'decaf · {level} · {kind}\nagent 收到的是整理版，改动如下：\n\n{changes}',
    full: 'decaf · {level} · {kind}\nagent 收到的整理版：\n\n{rewritten}',
    both: 'decaf · {level} · {kind}\nagent 收到的是整理版，改动如下：\n\n{changes}\n\n整理版全文：\n\n{rewritten}',
    cursorBlock:
      'decaf · {level} · {kind} · 这条没有发出\n\n建议改为（可复制后重发）：\n\n{rewritten}\n\n改动：\n\n{changes}\n\n要原样发送，在开头加 [raw] 再发。',
    error: 'decaf · 本条未检查（{error}），已原样发送',
    noApiKey:
      'decaf · 本条未检查：没有可用的 {provider} API key，已原样发送。\n解决方法：在终端里（不要在这个对话里）运行下面的命令并粘贴 key：\n{cmd}',
    noToken:
      'decaf · 本条未检查：decaf 无法登录 Claude，已原样发送。\n解决方法：在终端里（不要在这个对话里）依次运行\n1. claude setup-token\n2. {cmd}\n然后粘贴第 1 步最后打印出的 token。',
    notifyTitle: 'decaf · {level} · {kind} · agent 收到的是整理版',
  },
};

// Pick the language of the user's message. Only languages in STRINGS are
// returned; everything else falls back to English.
export function detectLang(text) {
  const t = String(text || '');
  if (/[぀-ヿ가-힯]/.test(t)) return 'en'; // Japanese / Korean: no strings yet
  const han = (t.match(/[一-鿿]/g) || []).length;
  const latinWords = (t.match(/[A-Za-z]+/g) || []).length;
  return han >= 2 && han >= latinWords ? 'zh' : 'en';
}

export function strings(cfg, text) {
  const lang = cfg.language && cfg.language !== 'auto' ? cfg.language : detectLang(text);
  const base = STRINGS[lang] || STRINGS.en;
  return { lang, ...base, ...(cfg.templates?.[lang] || {}) };
}
