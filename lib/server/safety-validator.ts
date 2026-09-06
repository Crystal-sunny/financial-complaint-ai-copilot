import type { InvestigationResult, ValidationCheck } from '../domain';
import { toolLabels } from './mock-tools';

export type InvestigationPayload = Omit<
  InvestigationResult,
  'agentRuns' | 'execution'
>;

type ValidationContext = {
  validSourceRecordIds: Set<string>;
  validRuleIds: Set<string>;
  currentCustomerId: string;
  currentLoanId: string | null;
  transactionRecords: Array<{
    transactionId: string;
    customerId: string;
    loanId: string | null;
    relatedScheduleId: string | null;
    type: string;
    amount: number;
    status: string;
  }>;
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

  const recommendationSources = new Set(
    result.evidence
      .filter((item) =>
        result.recommendation.evidenceIds.includes(item.evidenceId),
      )
      .map((item) => item.sourceRecordId),
  );
  const citedSuccessfulPayments = context.transactionRecords.filter(
    (item) =>
      recommendationSources.has(item.transactionId) &&
      item.customerId === context.currentCustomerId &&
      item.loanId === context.currentLoanId &&
      ['MANUAL_REPAYMENT', 'MANUAL_REPAYMENT_RETRY'].includes(item.type) &&
      ['SUCCESS', 'SUCCESS_AFTER_TIMEOUT'].includes(item.status) &&
      item.relatedScheduleId !== null &&
      item.amount > 0,
  );
  const citedProcessingReversals = context.transactionRecords.filter(
    (item) =>
      recommendationSources.has(item.transactionId) &&
      item.customerId === context.currentCustomerId &&
      item.loanId === context.currentLoanId &&
      item.type === 'AUTOMATIC_REVERSAL' &&
      item.status === 'PROCESSING' &&
      item.relatedScheduleId !== null &&
      item.amount > 0,
  );
  const duplicateEvidenceBound = citedProcessingReversals.some((reversal) => {
    const matchingPayments = citedSuccessfulPayments.filter(
      (payment) =>
        payment.customerId === reversal.customerId &&
        payment.loanId === reversal.loanId &&
        payment.relatedScheduleId === reversal.relatedScheduleId &&
        payment.amount === reversal.amount,
    );
    return (
      new Set(matchingPayments.map((item) => item.transactionId)).size >= 2
    );
  });
  assertCondition(
    result.recommendation.actionCode !== 'WAIT_FOR_REVERSAL' ||
      duplicateEvidenceBound,
    'DUPLICATE_EVIDENCE_BINDING',
    '等待冲正缺少两笔同客户同应收成功交易与匹配在途冲正证据',
  );
  checks.push(
    pass('DUPLICATE_EVIDENCE_BINDING', '重复扣款事实与在途冲正证据绑定有效'),
  );

  const actionRuleRequirements = {
    PROPOSE_REFUND: ['RULE-PAY-004', 'RULE-APPROVAL-002'],
    WAIT_FOR_REVERSAL: ['RULE-PAY-005'],
    ESCALATE_SECURITY: ['RULE-SECURITY-001'],
  } as const;
  const requiredActionRules =
    actionRuleRequirements[
      result.recommendation.actionCode as keyof typeof actionRuleRequirements
    ] ?? [];
  const expectedApproval =
    result.recommendation.actionCode === 'PROPOSE_REFUND' &&
    result.recommendation.amount !== null
      ? result.recommendation.amount <= 2000
        ? 'L1_SUPERVISOR'
        : 'L2_COMPLIANCE'
      : result.recommendation.actionCode === 'WAIT_FOR_REVERSAL'
        ? 'CASE_SPECIALIST'
        : result.recommendation.actionCode === 'ESCALATE_SECURITY'
          ? 'SECURITY_TEAM'
          : null;
  assertCondition(
    requiredActionRules.every((ruleId) =>
      result.recommendation.ruleIds.includes(ruleId),
    ) &&
      (expectedApproval === null || result.approval.level === expectedApproval),
    'DISPOSITION_RULE_BINDING',
    '处置动作缺少授权规则或审批层级与规则不一致',
  );
  checks.push(
    pass('DISPOSITION_RULE_BINDING', '处置动作、规则与审批层级绑定有效'),
  );

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
