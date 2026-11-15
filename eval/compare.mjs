// Combine the model-comparison runs (results tagged cmp-*) into one table.
//   node eval/compare.mjs   -> eval/private/compare/summary.md
// Prices: USD per 1M tokens, official pages, fetched 2026-11-13.
//   Anthropic https://platform.claude.com/docs/en/about-claude/pricing
//   OpenAI    https://developers.openai.com/api/docs/pricing
//   xAI       https://docs.x.ai/developers/pricing
//   Cursor    https://cursor.com/docs/models
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const PRICE = {
  // in, cacheRead, cacheWrite (Claude CLI writes 1-hour cache), out
  haiku: { in: 0.1, read: 0.01, write: 0.2, out: 0.5 },
  sonnet: { in: 2, read: 0.1, write: 4, out: 10 },
  'gpt-6-luna': { in: 0.1, read: 0.01, out: 0.5 },
  'gpt-5.6-luna': { in: 0.2, read: 0.02, out: 1.2 },
  'gpt-5.6-terra': { in: 2, read: 0.2, out: 12 },
  'composer-2.5': { in: 0.5, read: 0.2, out: 2.5 },
  'grok-4.7-low': { in: 2, read: 0.5, out: 6 },
  'gpt-5.3-codex-low': { in: 1.75, read: 0.175, out: 14 },
};
const suite = Object.fromEntries(JSON.parse(readFileSync(join(here, 'private', 'suite.json'), 'utf8')).map((x) => [x.id, x]));
const files = readdirSync(join(here, 'private', 'results')).filter((f) => /-cmp-.*\.json$/.test(f));
const rows = [];
for (const f of files) {
  const d = JSON.parse(readFileSync(join(here, 'private', 'results', f), 'utf8'));
  const rs = d.results.filter((r) => !r.error);
  const scored = rs.filter((r) => suite[r.id] && suite[r.id].act !== 'either');
  const pos = scored.filter((r) => suite[r.id].act === 'yes');
  const neg = scored.filter((r) => suite[r.id].act === 'no');
  const unstable = new Set();
  for (const id of new Set(scored.map((r) => r.id))) if (new Set(scored.filter((r) => r.id === id).map((r) => r.acted)).size > 1) unstable.add(id);
  const g = rs.filter((r) => r.acted && suite[r.id]?.keep && r.grade).map((r) => r.grade);
  const kp = g.flatMap((x) => x.kept || []);
  const p = PRICE[d.model] || {};
  // Cursor's inputTokens may or may not include cache reads; the stored value had
  // cacheRead subtracted, so add it back and bill all of it at the input price (upper bound).
  const fixU = (u) => (u && d.backend === 'cursor' ? { ...u, input: (u.input || 0) + (u.cacheRead || 0) } : u);
  const cost = (u0) => { const u = fixU(u0); return !u ? 0 : ((u.input || 0) * (p.in || 0) + (u.cacheRead || 0) * (p.read || 0) + (u.cacheWrite || 0) * (p.write ?? p.in ?? 0) + (u.output || 0) * (p.out || 0)) / 1e6; };
  const passCost = rs.filter((r) => !r.acted).map((r) => cost(r.usage));
  const actCost = rs.filter((r) => r.acted).map((r) => cost(r.usage));
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const tok = (k) => avg(rs.map((r) => (k === 'cacheRead' && d.backend === 'cursor' ? 0 : fixU(r.usage)?.[k]) || 0));
  const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
  rows.push({
    backend: d.backend, model: d.model, runs: d.runs, errors: d.results.length - rs.length,
    recall: `${pos.filter((r) => r.acted).length}/${pos.length}`,
    fp: `${neg.filter((r) => r.acted).length}/${neg.length}`,
    unstable: unstable.size,
    keep: kp.length ? Math.round((100 * kp.filter((k) => k.kept).length) / kp.length) + '%' : '—',
    clean: g.length ? Math.round((100 * g.filter((x) => !x.hostile_left?.length).length) / g.length) + '%' : '—',
    qlost: `${g.filter((x) => x.question_lost?.length).length}/${g.length}`,
    added: `${g.filter((x) => x.added?.length).length}/${g.length}`,
    ms: (ms[Math.floor(ms.length / 2)] / 1000).toFixed(1),
    inTok: Math.round(tok('input') + tok('cacheRead') + tok('cacheWrite')),
    outTok: Math.round(tok('output')),
    // typical traffic: ~10% of messages need a rewrite
    per1k: (1000 * (0.9 * avg(passCost) + 0.1 * avg(actCost))).toFixed(2),
  });
}
const order = ['claude', 'codex', 'cursor'];
rows.sort((a, b) => order.indexOf(a.backend) - order.indexOf(b.backend));
let md = `# 模型对比\n\n测试集 eval/suite.json（52 条），每个模型跑 ${rows[0]?.runs} 次，改写由 Opus 评分。\n\n`;
md += `| 工具 | 模型 | 该处理的抓到 | 不该处理却处理 | 不稳定条目 | 要点保留 | 改完无残留敌意 | 问句被改掉 | 有添加 | 耗时中位数(秒) | 平均输入 tokens | 平均输出 tokens | 每 1000 条消息费用(USD) |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.backend} | ${r.model} | ${r.recall} | ${r.fp} | ${r.unstable} | ${r.keep} | ${r.clean} | ${r.qlost} | ${r.added} | ${r.ms} | ${r.inTok} | ${r.outTok} | ${r.per1k}${r.errors ? `（失败 ${r.errors}）` : ''} |\n`;
md += `\n费用按 API 标价、按实测 token 计算，假设 10% 的消息需要改写。输入 tokens 包含各命令行工具自己附带的说明（Codex、Cursor 每次约 1 万）。走订阅时不直接按这个收费，而是占用订阅额度。\n`;
mkdirSync(join(here, 'private', 'compare'), { recursive: true });
writeFileSync(join(here, 'private', 'compare', 'summary.md'), md);
console.log(md);
