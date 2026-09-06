import './test-loader.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { prepareCandidate } from './model-candidate-fixtures.mjs';

const { investigateSyntheticCaseForEvaluation } =
  await import('../lib/server/pipeline-orchestrator.ts');

const selectedIds = ['EVAL-V2-003', 'EVAL-V2-006', 'EVAL-V2-010'];
const dataset = JSON.parse(
  await readFile(
    new URL('../evals/model-candidates-v2.json', import.meta.url),
    'utf8',
  ),
);
assert.equal(dataset.status, 'AUTHORIZED_FOR_AUTOMATIC_GLM_EVALUATION');

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
    amount: result.recommendation.amount,
    approvalLevel: result.approval.level,
    recommendationState: result.recommendation.state,
    conflict: result.conflict,
    rationale: result.recommendation.rationale,
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
  version: 'glm-candidates-v2-smoke-1',
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
    successfulModelResponses: runs.reduce(
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
const output = new URL(`glm-candidates-v2-${Date.now()}.json`, outputDirectory);
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  JSON.stringify({ report: output.pathname, summary: report.summary }),
);
if (
  report.summary.completed !== report.summary.total ||
  report.summary.machinePassed !== report.summary.total
)
  process.exitCode = 1;
