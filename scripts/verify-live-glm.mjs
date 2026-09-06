// Explicitly opt-in live verification; never imported by offline tests.
import './test-loader.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessLiveResult } from './live-result-checks.mjs';
if (!process.argv.includes('--approved-three-cases')) {
  throw new Error(
    'Live verification requires explicit authorization for the three cases.',
  );
}
const { investigateCase } =
  await import('../lib/server/pipeline-orchestrator.ts');
const selectedId = process.argv
  .find((value) => value.startsWith('--case='))
  ?.slice(7);
const caseIds = ['CMP-2026-09001', 'CMP-2026-09002', 'CMP-2026-09003'];
if (selectedId && !caseIds.includes(selectedId))
  throw new Error('Case is outside the approved scope');
const results = [];
for (const caseId of selectedId ? [selectedId] : caseIds) {
  const startedAt = performance.now();
  console.log(`START ${caseId}`);
  const result = await investigateCase(caseId, {
    provider: 'glm',
    signal: AbortSignal.timeout(240000),
    onEvent: (event) => console.log(JSON.stringify({ caseId, ...event })),
  });
  const summary = {
    caseId,
    runId: result.runId,
    actualProvider: result.execution.actualProvider,
    model: result.execution.model,
    fallbackUsed: result.execution.fallbackUsed,
    fallbackReason: result.execution.fallbackReason,
    wallDurationMs: Math.round(performance.now() - startedAt),
    evidenceCount: result.evidence.length,
    toolCalls: result.toolTraces.length,
    gate: result.evidenceGate,
    actionCode: result.recommendation.actionCode,
    amount: result.recommendation.amount,
    ...assessLiveResult(result),
    // Only validated application output, never raw failed supplier responses.
    conflict: result.conflict,
    rationale: result.recommendation.rationale,
    approval: result.approval.level,
    validationChecks: result.execution.validationChecks,
    agents: result.agentRuns.map((agent) => ({
      stageId: agent.stageId,
      provider: agent.provider,
      durationMs: agent.durationMs,
      responseId: agent.technicalDetails.responseId,
      inputTokens: agent.metrics.inputTokens,
      outputTokens: agent.metrics.outputTokens,
      omittedFieldCount: agent.technicalDetails.omittedFieldCount,
    })),
  };
  results.push(summary);
  console.log(JSON.stringify(summary));
}
const reportDirectory = resolve('evals/results');
await mkdir(reportDirectory, { recursive: true });
const reportPath = resolve(
  reportDirectory,
  `glm-live-${selectedId ?? 'all'}-${Date.now()}.json`,
);
await writeFile(
  reportPath,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scope: 'three-authorized-synthetic-cases',
      note: 'One run per case, no automatic retries. Not a model accuracy benchmark. Fallback usage is not model success; failed-call tokens are unavailable.',
      results,
    },
    null,
    2,
  ),
);
console.log(`REPORT ${reportPath}`);
if (results.some((result) => !result.businessPassed)) process.exitCode = 1;
