import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const suite = process.argv[2] ?? 'v3';
assert.match(suite, /^v[23]$/);
const appEvalDirectory = new URL('../evals/', import.meta.url);
const reportDirectory = new URL('../../evals/results/', import.meta.url);
const reviewDirectory = new URL('../../evals/reviews/', import.meta.url);
const dataset = JSON.parse(
  await readFile(
    new URL(`model-candidates-${suite}.json`, appEvalDirectory),
    'utf8',
  ),
);
const manifest = JSON.parse(
  await readFile(
    new URL(`model-evaluation-runs-${suite}.json`, appEvalDirectory),
    'utf8',
  ),
);

const reports = await Promise.all(
  manifest.baseline.map(async (entry) => ({
    batch: entry.batch,
    report: JSON.parse(
      await readFile(new URL(entry.report, reportDirectory), 'utf8'),
    ),
  })),
);
const runs = reports.flatMap((entry) =>
  entry.report.runs.map((run) => ({ ...run, batch: entry.batch })),
);
assert.deepEqual(
  runs.map((run) => run.id).sort(),
  dataset.cases.map((sample) => sample.id).sort(),
);

function clean(value) {
  return String(value ?? '-')
    .replaceAll('\n', ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const sections = dataset.cases.map((sample) => {
  const run = runs.find((item) => item.id === sample.id);
  assert.ok(run);
  const observed = run.result
    ? `${run.result.evidenceGate} / ${run.result.actionCode} / 金额 ${run.result.amount ?? '-'} / ${run.result.approvalLevel}`
    : `运行失败 / ${run.failure?.code ?? 'EVALUATION_FAILED'}`;
  const evidence = run.result?.evidenceSynopsis?.length
    ? run.result.evidenceSynopsis
        .map(
          (item) =>
            `  - ${clean(item.evidenceId)} · ${clean(item.sourceRecordId)}：${clean(item.claim)}`,
        )
        .join('\n')
    : '  - 无可复核的结构化证据摘要';
  const criteria = sample.expected.reviewChecks
    .map(
      (criterion, index) =>
        `${index + 1}. ${clean(criterion)}\n   - 结论：PASS / FAIL / UNCERTAIN\n   - 说明：`,
    )
    .join('\n');
  return `## ${sample.id}｜${clean(sample.name)}

- 类别：${clean(sample.category)}
- 运行批次：${clean(run.batch)}
- 运行状态：${clean(run.status)}
- 模型观测结果：${clean(observed)}
- 处置说明：${clean(run.result?.action)}
- 处置依据：${clean(run.result?.rationale)}

证据摘要：

${evidence}

人工复核项：

${criteria}

- 样本总评：PASS / FAIL / UNCERTAIN
- 复核备注：
`;
});

const markdown = `# ${dataset.version} 独立人工语义复核表

生成时间：${new Date().toISOString()}

## 使用说明

- 本表只展示模型的已校验结构化结果，不展示机器评分是否通过，也不展示允许动作、允许证据门等答案键。
- 复核者应逐项填写 PASS、FAIL 或 UNCERTAIN，并说明事实支持、过度承诺、漏拦截或过度升级问题。
- 复核者不应参与本轮提示词与护栏开发；完成全部样本并签名后，才可与机器答案解盲对比。
- 若同一样本需要讨论，先提交个人判断，再进行仲裁，避免后续样本受前述答案影响。

${sections.join('\n')}

## 复核签署

- 复核者：
- 复核日期：
- 是否独立于本轮开发：是 / 否
- 总体意见：
`;

await mkdir(reviewDirectory, { recursive: true });
const output = new URL(
  `model-candidates-${suite}-human-review.md`,
  reviewDirectory,
);
await writeFile(output, markdown, 'utf8');
console.log(
  JSON.stringify({ output: output.pathname, sampleCount: runs.length }),
);
