import type { InvestigationResult, ValidationCheck } from '../domain';

export type InvestigationPayload = Omit<InvestigationResult, 'execution'>;

type ValidationContext = {
  validSourceRecordIds: Set<string>;
  validRuleIds: Set<string>;
};

export class InvestigationValidationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'InvestigationValidationError';
  }
}

function pass(code: string, label: string): ValidationCheck {
  return { code, label, status: 'PASSED' };
}

function assertCondition(condition: boolean, code: string, message: string) {
  if (!condition) throw new InvestigationValidationError(message, code);
}

export function validateInvestigation(
  result: InvestigationPayload,
  context: ValidationContext,
) {
  const checks: ValidationCheck[] = [];
  const evidenceIds = result.evidence.map((item) => item.evidenceId);
  const evidenceIdSet = new Set(evidenceIds);

  assertCondition(
    evidenceIds.length === evidenceIdSet.size &&
      evidenceIds.every((item) => /^E-[A-Z0-9-]+$/i.test(item)),
    'EVIDENCE_ID_INTEGRITY',
    '证据 ID 缺失、重复或格式无效',
  );
  checks.push(pass('EVIDENCE_ID_INTEGRITY', '证据 ID 完整且唯一'));

  assertCondition(
    result.evidence.every((item) =>
      context.validSourceRecordIds.has(item.sourceRecordId),
    ),
    'SOURCE_RECORD_INTEGRITY',
    '模型引用了工具结果中不存在的来源记录',
  );
  checks.push(pass('SOURCE_RECORD_INTEGRITY', '证据均来自实际工具记录'));

  assertCondition(
    result.recommendation.evidenceIds.every((item) => evidenceIdSet.has(item)),
    'EVIDENCE_REFERENCE_INTEGRITY',
    '处置建议引用了不存在的证据',
  );
  checks.push(pass('EVIDENCE_REFERENCE_INTEGRITY', '处置建议证据引用有效'));

  assertCondition(
    result.recommendation.ruleIds.every((item) =>
      context.validRuleIds.has(item),
    ),
    'RULE_REFERENCE_INTEGRITY',
    '处置建议引用了未检索到的规则',
  );
  checks.push(pass('RULE_REFERENCE_INTEGRITY', '规则引用均已检索确认'));

  if (
    result.coordinator.mandatoryEscalation ||
    result.evidenceGate === 'MANDATORY_ESCALATION'
  ) {
    assertCondition(
      result.recommendation.actionCode === 'ESCALATE_SECURITY' &&
        result.recommendation.state === 'MANDATORY_ESCALATION' &&
        result.approval.level === 'SECURITY_TEAM',
      'MANDATORY_ESCALATION',
      '强制升级案件被模型降级或改为普通处置',
    );
  }
  checks.push(pass('MANDATORY_ESCALATION', '强制升级规则未被绕过'));

  assertCondition(
    !(
      result.recommendation.actionCode === 'PROPOSE_REFUND' &&
      result.evidenceGate !== 'SUFFICIENT'
    ),
    'FINANCIAL_ACTION_GATE',
    '证据不足或冲突时仍生成退款建议',
  );
  checks.push(pass('FINANCIAL_ACTION_GATE', '资金建议通过证据门控制'));

  assertCondition(
    result.toolTraces.length <= 12,
    'TOOL_CALL_LIMIT',
    '工具调用超过单次运行上限',
  );
  checks.push(pass('TOOL_CALL_LIMIT', '只读工具调用未超过上限'));

  return checks;
}
