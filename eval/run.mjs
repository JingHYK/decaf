// Fixed eval for decaf's check prompt.
//   node eval/run.mjs [--suite file.json] [--runs 3] [--only A1,B2] [--backend claude|codex|cursor] [--model <name>] [--grader opus]
// --suite defaults to eval/private/suite.json if it exists, else eval/example-suite.json.
// Results and reports go to eval/private/ (git-ignored: they contain message text).
// Each item is checked --runs times with the same prompt the hook uses.
// Rewrites of items with `keep` points are graded by a second model (eval/grade.md).
// Writes eval/results/<time>.json and eval/report.md (compared with the previous run).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCheck, CHECK_PROMPT } from '../src/check.js';
import { callModel } from '../src/backends.js';
import { loadConfig } from '../src/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RUNS = Number(arg('runs', 3));
const NOGRADE = process.argv.includes('--no-grade');
const ONLY = arg('only') ? arg('only').split(',') : null;
const base = loadConfig();
const BACKEND = arg('backend', 'claude');
const MODEL = arg('model', base.models[BACKEND]);
const cfgFor = (backend, model) => ({ ...base, backend, models: { ...base.models, [backend]: model }, timeoutMs: 180000 });
const GRADER = arg('grader', 'opus');
const OUT = join(here, 'private');
const SUITE_PATH = arg('suite') ? resolve(arg('suite')) : existsSync(join(OUT, 'suite.json')) ? join(OUT, 'suite.json') : join(here, 'example-suite.json');
const suite = JSON.parse(readFileSync(SUITE_PATH, 'utf8')).filter((x) => !ONLY || ONLY.includes(x.id));
const GRADE_PROMPT = readFileSync(join(here, 'grade.md'), 'utf8');
const EMOTION_WORDS = ['沮丧', '生气', '愤怒', '失望', '难过', '烦躁', '恼火', 'frustrat', 'angry', 'upset'];

const firstJson = (s) => JSON.parse(String(s).slice(String(s).indexOf('{'), String(s).lastIndexOf('}') + 1));

async function retry(fn) {
  try { return await fn(); } catch { return await fn(); }
}

async function one(item, run) {
  const t0 = Date.now();
  try {
    const resp = await retry(() => callModel(BACKEND, CHECK_PROMPT(), `<message>\n${item.text}\n</message>`, { ...cfgFor(BACKEND, MODEL), usage: true }));
    const r = parseCheck(resp.text);
    const acted = r.severity >= base.minSeverity && !!r.rewritten && r.rewritten !== item.text.trim();
    const out = { id: item.id, run, severity: r.severity, kind: r.kind, acted, rewritten: acted ? r.rewritten : null, ms: Date.now() - t0, usage: resp.usage };
    if (acted) {
      out.remove_left = (item.remove || []).filter((p) => r.rewritten.includes(p));
      out.emotion_added = EMOTION_WORDS.filter((w) => r.rewritten.includes(w) && !item.text.includes(w));
      if (item.keep && !NOGRADE) {
        try {
          const g = await retry(() => callModel('claude', GRADE_PROMPT,
            `<original>\n${item.text}\n</original>\n<rewritten>\n${r.rewritten}\n</rewritten>\n<keep>\n${item.keep.map((k) => '- ' + k).join('\n')}\n</keep>`, cfgFor('claude', GRADER)));
          out.grade = firstJson(g);
        } catch (e) { out.grade_error = e.message; }
      }
    }
    return out;
  } catch (e) {
    return { id: item.id, run, error: e.message, ms: Date.now() - t0 };
  }
}

const jobs = [];
for (let run = 1; run <= RUNS; run++) for (const item of suite) jobs.push([item, run]);
const results = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < jobs.length) {
    const [item, run] = jobs[next++];
    results.push(await one(item, run));
    process.stderr.write(`\r${results.length}/${jobs.length}`);
  }
}));
process.stderr.write('\n');

// ---------- report ----------
const resDir = join(OUT, 'results');
mkdirSync(resDir, { recursive: true });
const prevFile = readdirSync(resDir).filter((f) => f.endsWith(`-${BACKEND}.json`) || (BACKEND === 'claude' && !/-(codex|cursor)\.json$/.test(f) && f.endsWith('.json'))).sort().at(-1);
const prev = prevFile ? JSON.parse(readFileSync(join(resDir, prevFile), 'utf8')) : null;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const promptText = CHECK_PROMPT();
writeFileSync(join(resDir, `${stamp}${BACKEND === 'claude' ? '' : '-' + BACKEND}${arg('tag') ? '-' + arg('tag') : ''}.json`), JSON.stringify({ stamp, backend: BACKEND, model: MODEL, grader: GRADER, runs: RUNS, minSeverity: base.minSeverity, prompt: promptText, results }, null, 1));

const byId = Object.fromEntries(suite.map((x) => [x.id, x]));
const rs = (id) => results.filter((r) => r.id === id && !r.error);
const correct = (r) => (byId[r.id].act === 'yes' ? r.acted : !r.acted);
const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : '—');
const short = (s, n = 40) => { s = s.replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; };

function catStats(res) {
  const out = {};
  for (const x of suite) {
    if (x.act === 'either') continue;
    const c = (out[x.cat] ||= { act: x.act, items: 0, runs: 0, ok: 0, unstable: 0 });
    const r = res.filter((y) => y.id === x.id && !y.error);
    c.items++; c.runs += r.length; c.ok += r.filter(correct).length;
    if (new Set(r.map((y) => y.acted)).size > 1) c.unstable++;
  }
  return out;
}
const cs = catStats(results);
const pcs = prev ? catStats(prev.results.filter((r) => byId[r.id])) : null;

let md = `# decaf 测试报告\n\n- 时间：${stamp}\n- 判断+改写：${BACKEND} / ${MODEL || '默认模型'}；评分模型：${GRADER}；每条跑 ${RUNS} 次；处理门槛：强度 ≥ ${base.minSeverity}\n- 测试集：${SUITE_PATH.replace(here + '/', 'eval/')}，${suite.length} 条（${suite.filter((x) => x.src === '真实').length} 条真实消息）\n`;
if (prev) md += `- 对比：上一次 ${prevFile}${prev.prompt === promptText ? '（提示词相同）' : '（提示词不同）'}\n`;
const errs = results.filter((r) => r.error);
if (errs.length) md += `- 调用失败 ${errs.length} 次（不计入下面统计）\n`;

md += `\n## 一、判断\n\n每类按“次”统计：${RUNS} 次运行里判对的次数。“不稳定”= 同一条几次结果不一样。\n\n| 类别 | 应该 | 条数 | 判对 | 准确率 | 不稳定 |${pcs ? ' 上次准确率 |' : ''}\n|---|---|---|---|---|---|${pcs ? '---|' : ''}\n`;
for (const [cat, c] of Object.entries(cs))
  md += `| ${cat} | ${c.act === 'yes' ? '处理' : '不处理'} | ${c.items} | ${c.ok}/${c.runs} | ${pct(c.ok, c.runs)} | ${c.unstable} |${pcs ? ` ${pcs[cat] ? pct(pcs[cat].ok, pcs[cat].runs) : '—'} |` : ''}\n`;
const pos = results.filter((r) => !r.error && byId[r.id].act === 'yes');
const neg = results.filter((r) => !r.error && byId[r.id].act === 'no');
const tp = pos.filter((r) => r.acted).length, fp = neg.filter((r) => r.acted).length;
md += `\n合计：该处理的 ${pos.length} 次里抓到 ${tp} 次（查全率 ${pct(tp, pos.length)}）；不该处理的 ${neg.length} 次里误处理 ${fp} 次（误判率 ${pct(fp, neg.length)}）。\n`;

const wrongIds = suite.filter((x) => x.act !== 'either' && rs(x.id).some((r) => !correct(r)));
md += `\n### 判错的条目\n\n`;
if (!wrongIds.length) md += '无。\n';
for (const x of wrongIds) {
  const r = rs(x.id);
  md += `- **${x.id}**（${x.cat}，应该${x.act === 'yes' ? '处理' : '不处理'}）判错 ${r.filter((y) => !correct(y)).length}/${r.length} 次，强度 ${r.map((y) => y.severity).join('/')}：${short(x.text, 60)}\n`;
}

md += `\n## 二、改写\n\n只看被处理了的、带“必须保留要点”的条目。参照 ParaDetox 的三项指标里的前两项：敌意去掉了没有、意思保留了没有；另外检查有没有添加内容、有没有把真心提问改没了。\n\n`;
const acted = results.filter((r) => r.acted && byId[r.id].keep);
const graded = acted.filter((r) => r.grade);
const kp = graded.flatMap((r) => r.grade.kept || []);
const count = (f) => acted.filter(f).length;
md += `| 指标 | 结果 |\n|---|---|\n`;
md += `| 改写次数 | ${acted.length}（评分失败 ${acted.length - graded.length}） |\n`;
md += `| 指定的敌意词已去掉 | ${count((r) => !r.remove_left?.length)}/${acted.length} |\n`;
md += `| 评分模型认为没有残留敌意 | ${graded.filter((r) => !r.grade.hostile_left?.length).length}/${graded.length} |\n`;
md += `| 必须保留的要点 | ${kp.filter((k) => k.kept).length}/${kp.length}（${pct(kp.filter((k) => k.kept).length, kp.length)}） |\n`;
md += `| 全部要点都在的改写 | ${graded.filter((r) => (r.grade.kept || []).every((k) => k.kept)).length}/${graded.length} |\n`;
md += `| 有添加内容 | ${graded.filter((r) => r.grade.added?.length).length}/${graded.length} |\n`;
md += `| 加了原文没有的情绪词 | ${count((r) => r.emotion_added?.length)}/${acted.length} |\n`;
md += `| 真心提问被删或改成陈述 | ${graded.filter((r) => r.grade.question_lost?.length).length}/${graded.length} |\n`;

md += `\n### 有问题的改写\n\n`;
const bad = acted.filter((r) => r.remove_left?.length || r.emotion_added?.length || (r.grade && ((r.grade.kept || []).some((k) => !k.kept) || r.grade.added?.length || r.grade.question_lost?.length || r.grade.hostile_left?.length)));
if (!bad.length) md += '无。\n';
for (const r of bad) {
  const g = r.grade || {};
  const issues = [
    ...(r.remove_left || []).map((x) => `残留：${x}`),
    ...(g.hostile_left || []).map((x) => `残留：${x}`),
    ...(g.kept || []).filter((k) => !k.kept).map((k) => `丢了：${k.point}`),
    ...(g.added || []).map((x) => `添加：${x}`),
    ...(r.emotion_added || []).map((x) => `情绪词：${x}`),
    ...(g.question_lost || []).map((x) => `问句没了：${x}`),
  ];
  md += `**${r.id} 第 ${r.run} 次**\n\n原：${byId[r.id].text}\n\n改：${r.rewritten}\n\n${issues.map((x) => '- ' + x).join('\n')}\n\n`;
}

md += `\n## 三、边界条目（不计分）\n\n| 条目 | 各次强度 | 原文 |\n|---|---|---|\n`;
for (const x of suite.filter((x) => x.act === 'either')) md += `| ${x.id} | ${rs(x.id).map((r) => r.severity).join(' / ')} | ${short(x.text, 50)} |\n`;

const ms = results.filter((r) => !r.error).map((r) => r.ms).sort((a, b) => a - b);
md += `\n## 四、耗时\n\n单次判断（含改写和评分外的全部时间，${4} 路并发）：中位数 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} 秒，90% 在 ${(ms[Math.floor(ms.length * 0.9)] / 1000).toFixed(1)} 秒以内。并发会比单条实际使用慢一些。\n`;

md += `\n## 五、每条改写结果（第 1 次）\n\n`;
for (const x of suite) {
  const r = results.find((y) => y.id === x.id && y.run === 1);
  if (r?.acted) md += `- **${x.id}** 原：${x.text.replace(/\s+/g, ' ')}\n  改：${r.rewritten.replace(/\s+/g, ' ')}\n`;
}
const reportPath = arg('report') ? resolve(arg('report')) : join(OUT, BACKEND === 'claude' ? 'report.md' : `report-${BACKEND}.md`);
writeFileSync(reportPath, md);
console.log(reportPath);
