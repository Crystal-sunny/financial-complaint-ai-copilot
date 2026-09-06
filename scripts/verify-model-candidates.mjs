import './test-loader.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { prepareCandidate } from './model-candidate-fixtures.mjs';

const { investigateSyntheticCaseForEvaluation } =
  await import('../lib/server/pipeline-orchestrator.ts');

const [firstArgument, secondArgument] = process.argv.slice(2);
const suite = /^v[2345]$/.test(firstArgument ?? '') ? firstArgument : 'v2';
const batchName = suite === firstArgument ? secondArgument : firstArgument;
assert.ok(batchName, 'Provide a frozen batch name such as batch-1');
const datasetBaseName = `model-candidates-${suite}`;
const datasetText = await readFile(
  new URL(`../evals/${datasetBaseName}.json`, import.meta.url),
  'utf8',
);
const dataset = JSON.parse(datasetText);
const lock = JSON.parse(
  await readFile(
    new URL(`../evals/${datasetBaseName}.lock.json`, import.meta.url),
    'utf8',
  ),
);
assert.ok(
  [
    'AUTHORIZED_FOR_AUTOMATIC_GLM_EVALUATION',
    'FROZEN_FOR_GLM_EVALUATION',
  ].includes(dataset.status),
);
assert.equal(dataset.version, lock.version);
assert.equal(
  createHash('sha256').update(datasetText).digest('hex'),
  lock.datasetSha256,
  'Candidate dataset changed after scoring criteria were frozen',
);
const selectedIds =
  lock.batches[batchName] ?? lock.regressionBatches?.[batchName];
assert.ok(selectedIds, `Unknown frozen batch: ${batchName}`);
assert.ok(selectedIds.length >= 1 && selectedIds.length <= 3);
const evaluationKind = Object.hasOwn(lock.batches, batchName)
  ? ['v3', 'v4', 'v5'].includes(suite)
    ? 'FROZEN_HOLDOUT'
    : 'FROZEN_BASELINE'
  : 'DEVELOPMENT_REGRESSION';
const implementationFiles = [
  '../lib/server/agent-prompts.ts',
  '../lib/server/case-data-policy.ts',
  '../lib/server/mock-tools.ts',
  '../lib/server/model-contracts.ts',
  '../lib/server/model-provider.ts',
  '../lib/server/pipeline-orchestrator.ts',
  '../lib/server/safety-validator.ts',
  '../lib/server/schema-projection.ts',
  '../lib/server/schema-validator.ts',
  '../lib/server/tool-semantics.ts',
  './model-candidate-fixtures.mjs',
];
const implementationSha256 = createHash('sha256')
  .update(
    (
      await Promise.all(
        implementationFiles.map((path) =>
          readFile(new URL(path, import.meta.url), 'utf8'),
        ),
      )
    ).join('\n---FILE---\n'),
  )
  .digest('hex');

function machineAssessment(result, expected) {
  const checks = [
    {
      field: 'evidenceGate',
      expected: expected.allowedGates,
      actual: result.evidenceGate,
      passed: expected.allowedGates.includes(result.evidenceGate),
    },
    {
      field: 'actionCode',
      expected: expected.allowedActions,
      actual: result.recommendation.actionCode,
      passed: expected.allowedActions.includes(
        result.recommendation.actionCode,
      ),
    },
  ];
  if (Object.hasOwn(expected, 'approvalLevel'))
    checks.push({
      field: 'approvalLevel',
      expected: expected.approvalLevel,
      actual: result.approval.level,
      passed: result.approval.level === expected.approvalLevel,
    });
  if (Object.hasOwn(expected, 'amount'))
    checks.push({
      field: 'amount',
      expected: expected.amount,
      actual: result.recommendation.amount,
      passed: result.recommendation.amount === expected.amount,
    });
  return {
    passed: checks.every((check) => check.passed),
    checks,
  };
}

function safeFailure(error) {
  const allowedNames = new Set([
    'ModelProviderError',
    'InvestigationValidationError',
    'CaseDataTransmissionPausedError',
  ]);
  return {
    code:
      typeof error?.code === 'string' && /^[A-Z0-9_]+$/.test(error.code)
        ? error.code
        : 'EVALUATION_FAILED',
    message: allowedNames.has(error?.name)
      ? String(error.message)
      : '评测未完成，未保存供应商原始错误。',
    diagnostic:
      error?.name === 'ModelProviderError' &&
      typeof error.diagnostic === 'string' &&
      /^[A-Z0-9_:$.[\]-]{1,300}$/i.test(error.diagnostic)
        ? error.diagnostic
        : null,
  };
}

function publicResult(result) {
  return {
    runId: result.runId,
    actualProvider: result.execution.actualProvider,
    fallbackUsed: result.execution.fallbackUsed,
    model: result.execution.model,
    evidenceGate: result.evidenceGate,
    actionCode: result.recommendation.actionCode,
    action: result.recommendation.action,
    amount: result.recommendation.amount,
    approvalLevel: result.approval.level,
    recommendationState: result.recommendation.state,
    conflict: result.conflict,
    rationale: result.recommendation.rationale,
    evidenceSynopsis: result.evidence.map((item) => ({
      evidenceId: item.evidenceId,
      sourceRecordId: item.sourceRecordId,
      claim: item.claim,
    })),
    evidenceCount: result.evidence.length,
    toolCalls: result.toolTraces.map((trace) => ({
      name: trace.name,
      status: trace.status,
      recordCount: trace.recordCount,
    })),
    validationChecks: result.execution.validationChecks,
    agentRuns: result.agentRuns.map((agent) => ({
      stageId: agent.stageId,
      durationMs: agent.durationMs,
      responseId: agent.technicalDetails.responseId,
      inputTokens: agent.metrics.inputTokens,
      outputTokens: agent.metrics.outputTokens,
      omittedFieldCount: agent.technicalDetails.omittedFieldCount,
    })),
  };
}

const startedAt = new Date();
const runs = [];
for (const id of selectedIds) {
  const sample = dataset.cases.find((item) => item.id === id);
  assert.ok(sample, `Missing selected candidate ${id}`);
  const prepared = prepareCandidate(sample);
  let modelRequestAttempts = 0;
  try {
    const result = await investigateSyntheticCaseForEvaluation(
      prepared.case,
      prepared.database,
      prepared.forcedToolErrors,
      {
        signal: AbortSignal.timeout(240_000),
        onEvent: (event) => {
          if (event.type === 'stage_started') modelRequestAttempts++;
        },
      },
    );
    const assessment = machineAssessment(result, sample.expected);
    runs.push({
      id,
      name: sample.name,
      category: sample.category,
      status: 'COMPLETED',
      modelRequestAttempts,
      result: publicResult(result),
      machineAssessment: assessment,
      humanReview: sample.expected.reviewChecks.map((criterion) => ({
        criterion,
        status: 'NOT_REVIEWED',
      })),
    });
  } catch (error) {
    runs.push({
      id,
      name: sample.name,
      category: sample.category,
      status: 'FAILED',
      modelRequestAttempts,
      failure: safeFailure(error),
      machineAssessment: { passed: false, checks: [] },
      humanReview: sample.expected.reviewChecks.map((criterion) => ({
        criterion,
        status: 'NOT_REVIEWED',
      })),
    });
  }
}

const report = {
  version: `glm-candidates-${suite}-frozen-batch-1`,
  batchName,
  evaluationKind,
  datasetVersion: dataset.version,
  datasetSha256: lock.datasetSha256,
  implementationSha256,
  implementationSha256Scope: implementationFiles.map((path) =>
    path.replace(/^\.\.\//, ''),
  ),
  startedAt: startedAt.toISOString(),
  completedAt: new Date().toISOString(),
  provider: 'glm',
  model: process.env.GLM_MODEL?.trim() || 'glm-5.3-flash',
  selectedIds,
  controls: {
    data: 'registered synthetic and desensitized cases only',
    authorization: 'standing owner authorization recorded 2026-09-05',
    retryCount: 0,
    fallbackAllowed: false,
    rawProviderResponseStored: false,
    humanReviewStatus: 'NOT_REVIEWED',
  },
  runs,
  summary: {
    total: runs.length,
    completed: runs.filter((run) => run.status === 'COMPLETED').length,
    machinePassed: runs.filter((run) => run.machineAssessment.passed).length,
    modelRequestAttempts: runs.reduce(
      (total, run) => total + run.modelRequestAttempts,
      0,
    ),
    validatedModelResponses: runs.reduce(
      (total, run) => total + (run.result?.agentRuns.length ?? 0),
      0,
    ),
    reportedInputTokens: runs.reduce(
      (total, run) =>
        total +
        (run.result?.agentRuns.reduce(
          (subtotal, agent) => subtotal + (agent.inputTokens ?? 0),
          0,
        ) ?? 0),
      0,
    ),
    reportedOutputTokens: runs.reduce(
      (total, run) =>
        total +
        (run.result?.agentRuns.reduce(
          (subtotal, agent) => subtotal + (agent.outputTokens ?? 0),
          0,
        ) ?? 0),
      0,
    ),
  },
};

const outputDirectory = new URL('../../evals/results/', import.meta.url);
await mkdir(outputDirectory, { recursive: true });
const output = new URL(
  `glm-candidates-${suite}-${batchName}-${Date.now()}.json`,
  outputDirectory,
);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify({ report: output.pathname, summary: report.summary }),
);
if (
  report.summary.completed !== report.summary.total ||
  report.summary.machinePassed !== report.summary.total
)
  process.exitCode = 1;
