import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const suite = process.argv[2] ?? 'v3';
assert.match(suite, /^v[34]$/);
const appEvalDirectory = new URL('../evals/', import.meta.url);
const reportDirectory = new URL('../../evals/results/', import.meta.url);
const datasetText = await readFile(
  new URL(`model-candidates-${suite}.json`, appEvalDirectory),
  'utf8',
);
const dataset = JSON.parse(datasetText);
const manifest = JSON.parse(
  await readFile(
    new URL(`model-evaluation-runs-${suite}.json`, appEvalDirectory),
    'utf8',
  ),
);
assert.equal(dataset.version, manifest.datasetVersion);
assert.equal(
  createHash('sha256').update(datasetText).digest('hex'),
  manifest.datasetSha256,
);

const reports = await Promise.all(
  manifest.baseline.map(async (entry) => {
    const report = JSON.parse(
      await readFile(new URL(entry.report, reportDirectory), 'utf8'),
    );
    assert.equal(report.evaluationKind, 'FROZEN_HOLDOUT');
    assert.equal(report.datasetSha256, manifest.datasetSha256);
    assert.deepEqual(
      report.selectedIds,
      report.runs.map((run) => run.id),
    );
    return { ...entry, report };
  }),
);
const runs = reports.flatMap((entry) =>
  entry.report.runs.map((run) => ({ ...run, batch: entry.batch })),
);
assert.deepEqual(
  runs.map((run) => run.id).sort(),
  dataset.cases.map((sample) => sample.id).sort(),
);

const sum = (field) =>
  reports.reduce((total, entry) => total + entry.report.summary[field], 0);
const outcomes = runs.map((run) => ({
  id: run.id,
  batch: run.batch,
  status: run.status,
  machinePassed: run.machineAssessment.passed,
  failureCode: run.failure?.code ?? null,
  evidenceGate: run.result?.evidenceGate ?? null,
  actionCode: run.result?.actionCode ?? null,
  approvalLevel: run.result?.approvalLevel ?? null,
  amount: run.result?.amount ?? null,
}));
const completed = outcomes.filter((item) => item.status === 'COMPLETED').length;
const machinePassed = outcomes.filter((item) => item.machinePassed).length;
const scorecard = {
  version: `model-candidates-${suite}-holdout-scorecard-1`,
  generatedAt: new Date().toISOString(),
  datasetVersion: dataset.version,
  datasetSha256: manifest.datasetSha256,
  evaluationKind: 'FROZEN_HOLDOUT',
  model: reports[0].report.model,
  implementationSha256: [
    ...new Set(reports.map((entry) => entry.report.implementationSha256)),
  ],
  implementationSha256Scope: reports[0].report.implementationSha256Scope ?? [
    'lib/server/agent-prompts.ts',
    'lib/server/safety-validator.ts',
    'lib/server/pipeline-orchestrator.ts',
  ],
  summary: {
    total: outcomes.length,
    completed,
    completionRate: completed / outcomes.length,
    machinePassed,
    machinePassRate: machinePassed / outcomes.length,
    modelRequestAttempts: sum('modelRequestAttempts'),
    validatedModelResponses: sum('validatedModelResponses'),
    reportedInputTokens: sum('reportedInputTokens'),
    reportedOutputTokens: sum('reportedOutputTokens'),
  },
  outcomes,
  interpretation: {
    humanReview: 'NOT_REVIEWED',
    frozenBeforeFirstModelRequest: true,
    noPostRunRetryOrPromptTuning: true,
    independentlyAuthoredOrLabeledBenchmark: false,
    tokenCountsExcludeFailedRunsWithoutValidatedMetadata: true,
  },
};

const percent = (scorecard.summary.machinePassRate * 100).toFixed(1);
const completionPercent = (scorecard.summary.completionRate * 100).toFixed(1);
const markdown = `# GLM ${suite.toUpperCase()} 冻结留出集计分卡

- 数据集：${scorecard.datasetVersion}
- 模型：${scorecard.model}
- 端到端完成：${completed}/${outcomes.length}（${completionPercent}%）
- 机器通过：${machinePassed}/${outcomes.length}（${percent}%）
- 模型请求尝试：${scorecard.summary.modelRequestAttempts}
- 已返回校验元数据的 Token：输入 ${scorecard.summary.reportedInputTokens}，输出 ${scorecard.summary.reportedOutputTokens}
- 独立人工语义复核：未完成

| 样本 | 批次 | 状态 | 机器结果 | 证据门 | 动作／失败 |
|---|---|---|---|---|---|
${outcomes
  .map(
    (item) =>
      `| ${item.id} | ${item.batch} | ${item.status} | ${item.machinePassed ? '通过' : '失败'} | ${item.evidenceGate ?? '-'} | ${item.actionCode ?? item.failureCode ?? '-'} |`,
  )
  .join('\n')}

> ${suite.toUpperCase()} 在首次模型请求前冻结，并且本轮没有按结果修改提示词或重跑失败样本；但样本仍由项目开发方编写，不是独立机构基准。机器通过不能替代人工语义复核，失败运行缺失的 Token 元数据不计入合计。
`;

await writeFile(
  new URL(`model-candidates-${suite}-scorecard.json`, reportDirectory),
  `${JSON.stringify(scorecard, null, 2)}\n`,
  'utf8',
);
await writeFile(
  new URL(`model-candidates-${suite}-scorecard.md`, reportDirectory),
  markdown,
  'utf8',
);
console.log(JSON.stringify(scorecard.summary));
