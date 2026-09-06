// Independent smoke expectations. Never included in the model input.
const expectations = {
  'CMP-2026-09001': {
    gate: 'SUFFICIENT',
    action: 'PROPOSE_REFUND',
    amount: 1248.36,
    approval: 'L1_SUPERVISOR',
  },
  'CMP-2026-09002': {
    gate: 'SUFFICIENT',
    action: 'WAIT_FOR_REVERSAL',
    amount: 588.2,
    approval: 'CASE_SPECIALIST',
  },
  'CMP-2026-09003': {
    gate: 'MANDATORY_ESCALATION',
    action: 'ESCALATE_SECURITY',
    amount: null,
    approval: 'SECURITY_TEAM',
  },
};

export function assessLiveResult(result) {
  const expected = expectations[result.caseId];
  if (!expected) throw new Error('No approved smoke expectation for this case');
  const actual = {
    gate: result.evidenceGate,
    action: result.recommendation.actionCode,
    amount: result.recommendation.amount,
    approval: result.approval.level,
  };
  const modelContractPassed =
    result.execution.actualProvider === 'glm' && !result.execution.fallbackUsed;
  const businessChecks = Object.entries(expected).map(([field, value]) => ({
    field,
    expected: value,
    actual: actual[field],
    status: !modelContractPassed
      ? 'NOT_EVALUATED'
      : actual[field] === value
        ? 'PASSED'
        : 'FAILED',
  }));
  return {
    modelContractPassed,
    businessChecks,
    businessPassed:
      modelContractPassed &&
      businessChecks.every((check) => check.status === 'PASSED'),
  };
}
