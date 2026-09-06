import type { InvestigationResult } from '../domain';
import { approveCase, investigateRecordedCase } from './recorded-orchestrator';

// Bounded, short-lived local workflow context, not durable case storage. Only
// validated server results can enter it; client-supplied decisions are ignored.
const runs = new Map<
  string,
  { result: InvestigationResult; expiresAt: number }
>();

export function registerApprovalContext(result: InvestigationResult) {
  for (const [key, value] of runs)
    if (value.expiresAt <= Date.now() || value.result.caseId === result.caseId)
      runs.delete(key);
  if (runs.size >= 100) runs.delete(runs.keys().next().value!);
  runs.set(result.runId, { result, expiresAt: Date.now() + 60 * 60 * 1000 });
}

export function approveValidatedInvestigation(caseId: string, runId: string) {
  const context = runs.get(runId);
  if (
    !context ||
    context.expiresAt <= Date.now() ||
    context.result.caseId !== caseId
  )
    return null;
  const { result } = context;
  if (
    result.recommendation.state === 'NEEDS_INFORMATION' ||
    ['INSUFFICIENT', 'CONFLICT_BLOCKED'].includes(result.evidenceGate)
  )
    return null;
  // Existing approval outcomes cover three fixture decisions. A differing model
  // recommendation needs human verification, not an unrelated canned approval.
  const supported = investigateRecordedCase(caseId);
  if (
    !supported ||
    result.recommendation.actionCode !== supported.recommendation.actionCode ||
    result.approval.level !== supported.approval.level ||
    (result.recommendation.actionCode === 'PROPOSE_REFUND' &&
      result.recommendation.amount !== supported.recommendation.amount)
  )
    return null;
  return approveCase(caseId);
}
