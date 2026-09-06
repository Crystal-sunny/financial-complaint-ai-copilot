import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const appEvalDirectory = new URL('../evals/', import.meta.url);
const reportDirectory = new URL('../../evals/results/', import.meta.url);
const manifest = JSON.parse(
  await readFile(
    new URL('model-evaluation-runs-v2.json', appEvalDirectory),
    'utf8',
  ),
);
const dataset = JSON.parse(
  await readFile(new URL('model-candidates-v2.json', appEvalDirectory), 'utf8'),
);
assert.equal(manifest.datasetVersion, dataset.version);

async function loadReports(entries) {
  return Promise.all(
    entries.map(async (entry) => {
      const report = JSON.parse(
        await readFile(new URL(entry.report, reportDirectory), 'utf8'),
      );
      assert.deepEqual(
        report.selectedIds,
        report.runs.map((run) => run.id),
      );
      return { ...entry, report };
    }),
  );
}

function metrics(reports) {
  return {
    candidateRuns: reports.reduce(
      (total, entry) => total + entry.report.summary.total,
      0,
    ),
    completed: reports.reduce(
      (total, entry) => total + entry.report.summary.completed,
      0,
    ),
    machinePassed: reports.reduce(
      (total, entry) => total + entry.report.summary.machinePassed,
      0,
    ),
    modelRequestAttempts: reports.reduce(
      (total, entry) => total + entry.report.summary.modelRequestAttempts,
      0,
    ),
    validatedModelResponses: reports.reduce(
      (total, entry) =>
        total +
        (entry.report.summary.validatedModelResponses ??
          entry.report.summary.successfulModelResponses ??
          0),
      0,
    ),
    reportedInputTokens: reports.reduce(
      (total, entry) => total + entry.report.summary.reportedInputTokens,
      0,
    ),
    reportedOutputTokens: reports.reduce(
      (total, entry) => total + entry.report.summary.reportedOutputTokens,
      0,
    ),
  };
}

function outcome(run, batch) {
  return {
    id: run.id,
    batch,
    status: run.status,
    machinePassed: run.machineAssessment.passed,
    failureCode: run.failure?.code ?? null,
    evidenceGate: run.result?.evidenceGate ?? null,
    actionCode: run.result?.actionCode ?? null,
  };
}

const baselineReports = await loadReports(manifest.baseline);
const regressionReports = await loadReports(manifest.regressions);
const baselineOutcomes = baselineReports.flatMap((entry) =>
  entry.report.runs.map((run) => outcome(run, entry.batch)),
);
assert.deepEqual(
  baselineOutcomes.map((item) => item.id).sort(),
  dataset.cases.map((item) => item.id).sort(),
);
const latestByCase = new Map(baselineOutcomes.map((item) => [item.id, item]));
for (const entry of regressionReports)
  for (const run of entry.report.runs)
    latestByCase.set(run.id, outcome(run, entry.batch));
const latestOutcomes = dataset.cases.map((sample) => {
  const item = latestByCase.get(sample.id);
  assert.ok(item);
  return item;
});

const baseline = metrics(baselineReports);
const regressions = metrics(regressionReports);
const scorecard = {
  version: 'model-candidates-v2-scorecard-1',
  generatedAt: new Date().toISOString(),
  datasetVersion: manifest.datasetVersion,
  datasetSha256: manifest.datasetSha256,
  model: 'glm-5.3-flash',
  baseline: {
    ...baseline,
    validatedRate: baseline.completed / baseline.candidateRuns,
    machinePassRate: baseline.machinePassed / baseline.candidateRuns,
    outcomes: baselineOutcomes,
  },
  developmentRegressions: {
    ...regressions,
    latestCompleted: latestOutcomes.filter(
      (item) => item.status === 'COMPLETED',
    ).length,
    latestMachinePassed: latestOutcomes.filter((item) => item.machinePassed)
      .length,
    latestOutcomes,
  },
  totalUsage: {
    modelRequestAttempts:
      baseline.modelRequestAttempts + regressions.modelRequestAttempts,
    reportedInputTokens:
      baseline.reportedInputTokens + regressions.reportedInputTokens,
    reportedOutputTokens:
      baseline.reportedOutputTokens + regressions.reportedOutputTokens,
  },
  interpretation: {
    humanReview: 'NOT_REVIEWED',
    tokenCountsExcludeFailedRunsWithoutValidatedMetadata: true,
    latestOutcomesAreTargetedDevelopmentRegressionsNotBlindAccuracy: true,
  },
};

const baselinePercent = (scorecard.baseline.machinePassRate * 100).toFixed(1);
const markdown = `# GLM 模型候选评测计分卡

- 数据集：${scorecard.datasetVersion}
- 模型：${scorecard.model}
- 首次基线：${baseline.machinePassed}/${baseline.candidateRuns}（${baselinePercent}%）机器通过；${baseline.completed}/${baseline.candidateRuns} 完成端到端校验
- 开发回归后的最新结果：${scorecard.developmentRegressions.latestMachinePassed}/${latestOutcomes.length} 机器通过
- 总请求尝试：${scorecard.totalUsage.modelRequestAttempts}
- 已返回校验元数据的 Token：输入 ${scorecard.totalUsage.reportedInputTokens}，输出 ${scorecard.totalUsage.reportedOutputTokens}
- 独立人工语义复核：未完成

## 首次基线

| 样本 | 批次 | 状态 | 机器结果 | 证据门 | 动作／失败 |
|---|---|---|---|---|---|
${baselineOutcomes
  .map(
    (item) =>
      `| ${item.id} | ${item.batch} | ${item.status} | ${item.machinePassed ? '通过' : '失败'} | ${item.evidenceGate ?? '-'} | ${item.actionCode ?? item.failureCode ?? '-'} |`,
  )
  .join('\n')}

## 调优后的最新开发回归

| 样本 | 最新批次 | 状态 | 机器结果 | 证据门 | 动作／失败 |
|---|---|---|---|---|---|
${latestOutcomes
  .map(
    (item) =>
      `| ${item.id} | ${item.batch} | ${item.status} | ${item.machinePassed ? '通过' : '失败'} | ${item.evidenceGate ?? '-'} | ${item.actionCode ?? item.failureCode ?? '-'} |`,
  )
  .join('\n')}

> 最新 12/12 来自针对失败样本的开发回归，只能证明这些回归在本次运行通过，不能替代独立盲测或稳定性统计。失败运行未返回的 Token 元数据不计入 Token 合计。
`;

await writeFile(
  new URL('model-candidates-v2-scorecard.json', reportDirectory),
  `${JSON.stringify(scorecard, null, 2)}\n`,
  'utf8',
);
await writeFile(
  new URL('model-candidates-v2-scorecard.md', reportDirectory),
  markdown,
  'utf8',
);
console.log(
  JSON.stringify({
    baseline: {
      total: baseline.candidateRuns,
      completed: baseline.completed,
      machinePassed: baseline.machinePassed,
    },
    latest: {
      total: latestOutcomes.length,
      completed: scorecard.developmentRegressions.latestCompleted,
      machinePassed: scorecard.developmentRegressions.latestMachinePassed,
    },
    totalUsage: scorecard.totalUsage,
  }),
);
