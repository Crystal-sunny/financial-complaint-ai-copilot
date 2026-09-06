import type { InvestigationResult, ValidationCheck } from '../domain';
import { toolLabels } from './mock-tools';

export type InvestigationPayload = Omit<
  InvestigationResult,
  'agentRuns' | 'execution'
>;

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
  const financialProposal = ['PROPOSE_REFUND', 'WAIT_FOR_REVERSAL'].includes(
    result.recommendation.actionCode,
  );

  assertCondition(
    (!financialProposal || evidenceIds.length > 0) &&
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
    (!financialProposal || result.recommendation.evidenceIds.length > 0) &&
      result.recommendation.evidenceIds.every((item) =>
        evidenceIdSet.has(item),
      ),
    'EVIDENCE_REFERENCE_INTEGRITY',
    '处置建议引用了不存在的证据',
  );
  checks.push(pass('EVIDENCE_REFERENCE_INTEGRITY', '处置建议证据引用有效'));

  assertCondition(
    (!financialProposal || result.recommendation.ruleIds.length > 0) &&
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

  const blockedGate = ['INSUFFICIENT', 'CONFLICT_BLOCKED'].includes(
    result.evidenceGate,
  );
  const criticalReadsSucceeded = [
    'get_payment_transactions',
    'search_rules',
  ].every(
    (name) =>
      result.toolTraces.some(
        (trace) =>
          trace.name === name && trace.status === 'OK' && trace.recordCount > 0,
      ) &&
      !result.toolTraces.some(
        (trace) => trace.name === name && trace.status !== 'OK',
      ),
  );
  assertCondition(
    (!blockedGate ||
      (['REQUEST_INFORMATION', 'MANUAL_REVIEW'].includes(
        result.recommendation.actionCode,
      ) &&
        result.recommendation.state === 'NEEDS_INFORMATION')) &&
      !(
        result.evidenceGate === 'SUFFICIENT' &&
        result.conflict.status === 'UNRESOLVED'
      ) &&
      (!financialProposal ||
        (result.evidenceGate === 'SUFFICIENT' &&
          result.recommendation.state === 'PENDING_APPROVAL' &&
          result.recommendation.amount !== null &&
          Number.isFinite(result.recommendation.amount) &&
          result.recommendation.amount > 0 &&
          criticalReadsSucceeded)),
    'FINANCIAL_ACTION_GATE',
    '证据、查询结果、金额或处置状态不支持当前资金建议',
  );
  checks.push(pass('FINANCIAL_ACTION_GATE', '资金建议通过证据门控制'));

  assertCondition(
    result.toolTraces.every((trace) => Object.hasOwn(toolLabels, trace.name)),
    'TOOL_PERMISSION',
    '调查轨迹包含未授权工具',
  );
  checks.push(pass('TOOL_PERMISSION', '调查仅包含授权只读工具'));

  assertCondition(
    result.toolTraces.length <= 12,
    'TOOL_CALL_LIMIT',
    '工具调用超过单次运行上限',
  );
  checks.push(pass('TOOL_CALL_LIMIT', '只读工具调用未超过上限'));

  return checks;
}
