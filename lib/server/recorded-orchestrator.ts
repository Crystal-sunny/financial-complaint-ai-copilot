import type {
  Evidence,
  InvestigationResult,
  MockCase,
  ToolName,
} from '@/lib/domain';
import { mockDatabase } from '@/lib/server/mock-database';
import { runReadOnlyTool, traceToolCall } from '@/lib/server/mock-tools';

const toolPlan: ToolName[] = [
  'get_customer_profile',
  'get_loan_contract',
  'get_repayment_plan',
  'get_payment_transactions',
  'get_early_repayment_requests',
  'get_support_tickets',
  'get_account_security_events',
  'search_rules',
];

function callArguments(
  caseItem: MockCase,
  tool: ToolName,
): Record<string, unknown> {
  switch (tool) {
    case 'get_customer_profile':
      return { customerId: caseItem.customerId };
    case 'get_loan_contract':
    case 'get_repayment_plan':
    case 'get_early_repayment_requests':
      return { loanId: caseItem.loanId };
    case 'get_payment_transactions':
      return {
        customerId: caseItem.customerId,
        loanId: caseItem.loanId,
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      };
    case 'get_support_tickets':
      return { customerId: caseItem.customerId, caseId: caseItem.caseId };
    case 'get_account_security_events':
      return {
        customerId: caseItem.customerId,
        dateFrom: '2026-08-01',
        dateTo: '2026-08-31',
      };
    case 'search_rules':
      return {
        query: '投诉调查与处置',
        effectiveAt: '2026-08-31',
        businessType: caseItem.expectedType,
      };
  }
}

const earlyRepaymentEvidence: Evidence[] = [
  {
    evidenceId: 'E-001',
    evidenceType: 'EARLY_REPAYMENT_REQUEST',
    sourceSystem: '提前还款系统',
    sourceRecordId: 'ER-9001',
    observedAt: '2026-08-12T09:42:00+08:00',
    title: '提交提前还款申请',
    claim: '页面回执仅确认申请已提交',
    rawExcerpt: '提前还款申请已提交，请关注后续处理结果。',
    tone: 'neutral',
  },
  {
    evidenceId: 'E-002',
    evidenceType: 'PAYMENT_TRANSACTION',
    sourceSystem: '支付流水',
    sourceRecordId: 'TXN-8101',
    observedAt: '2026-08-12T09:47:00+08:00',
    title: '结清金额支付成功',
    claim: '客户支付结清金额 ¥9,872.41',
    rawExcerpt: 'EARLY_REPAYMENT · SUCCESS · ¥9,872.41',
    tone: 'good',
  },
  {
    evidenceId: 'E-003',
    evidenceType: 'PAYMENT_TRANSACTION',
    sourceSystem: '批量扣款系统',
    sourceRecordId: 'PAY-BATCH-815',
    observedAt: '2026-08-13T00:30:00+08:00',
    title: '批量扣款指令入队',
    claim: '原定还款计划进入夜间批次',
    rawExcerpt: 'AUTOPAY_BATCH_INSTRUCTION · QUEUED · ¥1,248.36',
    tone: 'warn',
  },
  {
    evidenceId: 'E-004',
    evidenceType: 'LOAN_STATUS_EVENT',
    sourceSystem: '核心贷款系统',
    sourceRecordId: 'LOAN-3001-E7',
    observedAt: '2026-08-13T02:10:00+08:00',
    title: '贷款完成结清',
    claim: '贷款状态由处理中变更为已结清',
    rawExcerpt: 'EARLY_REPAYMENT_PROCESSING → SETTLED',
    tone: 'good',
  },
  {
    evidenceId: 'E-005',
    evidenceType: 'REVERSAL_TRANSACTION',
    sourceSystem: '批量扣款系统',
    sourceRecordId: 'CMD-815-R1',
    observedAt: '2026-08-13T02:12:00+08:00',
    title: '撤销指令执行超时',
    claim: '结清后撤销扣款指令，但渠道超时',
    rawExcerpt: 'AUTOPAY_REVOCATION · TIMEOUT · ¥1,248.36',
    tone: 'bad',
  },
  {
    evidenceId: 'E-006',
    evidenceType: 'PAYMENT_TRANSACTION',
    sourceSystem: '支付流水',
    sourceRecordId: 'TXN-8159',
    observedAt: '2026-08-15T07:13:00+08:00',
    title: '结清后扣款成功',
    claim: '已取消应收计划仍发生扣款',
    rawExcerpt: 'SCHEDULED_DEBIT · SUCCESS · ¥1,248.36',
    tone: 'bad',
  },
];

const duplicateDebitEvidence: Evidence[] = [
  {
    evidenceId: 'E-101',
    evidenceType: 'PAYMENT_TRANSACTION',
    sourceSystem: '支付流水',
    sourceRecordId: 'TXN-8201',
    observedAt: '2026-08-20T09:08:00+08:00',
    title: '首次还款延迟成功',
    claim: '首次请求超时后最终成功',
    rawExcerpt: 'MANUAL_REPAYMENT · SUCCESS_AFTER_TIMEOUT · ¥588.20',
    tone: 'warn',
  },
  {
    evidenceId: 'E-102',
    evidenceType: 'PAYMENT_TRANSACTION',
    sourceSystem: '支付流水',
    sourceRecordId: 'TXN-8202',
    observedAt: '2026-08-20T09:06:00+08:00',
    title: '重试还款成功',
    claim: '第二次请求指向同一应收计划并成功',
    rawExcerpt: 'MANUAL_REPAYMENT_RETRY · SUCCESS · ¥588.20',
    tone: 'bad',
  },
  {
    evidenceId: 'E-103',
    evidenceType: 'REVERSAL_TRANSACTION',
    sourceSystem: '支付流水',
    sourceRecordId: 'REV-8201',
    observedAt: '2026-08-20T09:40:00+08:00',
    title: '自动冲正在途',
    claim: '系统已发起自动冲正，尚未得到最终结果',
    rawExcerpt: 'AUTOMATIC_REVERSAL · PROCESSING · ¥588.20',
    tone: 'warn',
  },
];

const securityEvidence: Evidence[] = [
  {
    evidenceId: 'E-201',
    evidenceType: 'ACCOUNT_SECURITY_EVENT',
    sourceSystem: '账户安全平台',
    sourceRecordId: 'SEC-8280',
    observedAt: '2026-08-28T01:09:00+08:00',
    title: '陌生设备异地登录',
    claim: '非常用 Android 设备在深圳登录',
    rawExcerpt: 'NEW_DEVICE · LOCATION_DEVIATION · UNUSUAL_HOUR',
    tone: 'bad',
  },
  {
    evidenceId: 'E-202',
    evidenceType: 'PAYMENT_TRANSACTION',
    sourceSystem: '钱包支付',
    sourceRecordId: 'TXN-8281—8283',
    observedAt: '2026-08-28T01:21:02+08:00',
    title: '八分钟内三笔交易',
    claim: '陌生设备登录后连续发生三笔交易，共 ¥2,578.00',
    rawExcerpt: '¥680.00 + ¥1,299.00 + ¥599.00',
    tone: 'bad',
  },
  {
    evidenceId: 'E-203',
    evidenceType: 'CUSTOMER_STATEMENT',
    sourceSystem: '客诉工单',
    sourceRecordId: 'TKT-9003',
    observedAt: '2026-08-28T08:06:00+08:00',
    title: '客户明确否认授权',
    claim: '客户称登录与三笔交易均非本人操作',
    rawExcerpt: '这些都不是我操作的，请立刻处理。',
    tone: 'warn',
  },
];

function buildDisposition(
  caseItem: MockCase,
): Omit<InvestigationResult, 'runId' | 'generatedAt' | 'toolTraces'> {
  if (caseItem.expectedType === 'early_repayment_debit') {
    return {
      caseId: caseItem.caseId,
      mode: 'RECORDED',
      coordinator: {
        complaintType: caseItem.expectedType,
        riskLevel: 'MEDIUM',
        mandatoryEscalation: false,
        summary: '提前还款结清与后续自动扣款争议，包含监管投诉意向。',
      },
      evidence: earlyRepaymentEvidence,
      confirmedFacts: [
        '页面回执仅表示申请已提交，贷款于 8 月 13 日 02:10 实际结清。',
        '结清后的撤销指令超时，8 月 15 日仍完成 ¥1,248.36 扣款。',
        '截至当前记录更新时间，未发现逾期状态事件。',
      ],
      conflict: {
        title: '“申请成功”是否等于“贷款已结清”',
        resolution:
          '不等同；以核心贷款状态事件为准。但后续扣款确属结清后异常扣款。',
        status: 'RESOLVED',
      },
      evidenceGate: 'SUFFICIENT',
      recommendation: {
        actionCode: 'PROPOSE_REFUND',
        action: '建议原路退回异常扣款 ¥1,248.36',
        amount: 1248.36,
        rationale:
          '扣款发生在贷款结清之后，且对应应收计划已因结清取消；撤销超时是最可能的直接原因。',
        state: 'PENDING_APPROVAL',
        ruleIds: ['RULE-PAY-004', 'RULE-APPROVAL-002', 'RULE-CREDIT-003'],
      },
      approval: {
        level: 'L1_SUPERVISOR',
        reason: '金额不超过 ¥2,000，进入一级组长审批。',
      },
      prohibitedActions: ['不得声称退款已完成', '不得承诺未来绝不影响征信'],
      responseDraft:
        '林女士，您好。我们已核实：您的贷款于 8 月 13 日 02:10 完成结清；8 月 15 日扣取的 1,248.36 元发生在结清之后，属于异常扣款。我们已形成原路退回建议，当前仍需一级组长审批，退款是否通过及到账时间以审批和渠道处理结果为准。截至当前记录，未发现该事项产生逾期记录。给您带来不便，我们深表歉意。',
      auditEvents: [
        { at: '10:26:00', actor: '系统', action: '案件进入待调查队列' },
        {
          at: '10:27:04',
          actor: '案件协调 Agent',
          action: '识别业务类型与中风险等级',
        },
        {
          at: '10:27:06',
          actor: '事实调查 Agent',
          action: '完成八类只读数据核验',
        },
        { at: '10:27:07', actor: '处置合规 Agent', action: '生成一级审批建议' },
      ],
    };
  }

  if (caseItem.expectedType === 'duplicate_debit') {
    return {
      caseId: caseItem.caseId,
      mode: 'RECORDED',
      coordinator: {
        complaintType: caseItem.expectedType,
        riskLevel: 'MEDIUM',
        mandatoryEscalation: false,
        summary: '同一应收计划存在两笔成功交易，自动冲正仍在处理中。',
      },
      evidence: duplicateDebitEvidence,
      confirmedFacts: [
        '两笔 ¥588.20 交易均指向同一应收计划。',
        '首笔交易在超时后最终成功。',
        '自动冲正 REV-8201 仍在处理中。',
      ],
      conflict: {
        title: '重复扣款是否需要立即人工退款',
        resolution:
          '重复事实成立，但自动冲正在途；需等待渠道最终状态，避免重复退款。',
        status: 'RESOLVED',
      },
      evidenceGate: 'SUFFICIENT',
      recommendation: {
        actionCode: 'WAIT_FOR_REVERSAL',
        action: '等待自动冲正完成并由支付专员复核',
        amount: 588.2,
        rationale: '已有自动冲正在途，当前再次提交人工退款可能造成重复退回。',
        state: 'NEEDS_INFORMATION',
        ruleIds: ['RULE-PAY-005', 'RULE-COMPLAINT-001'],
      },
      approval: {
        level: 'CASE_SPECIALIST',
        reason: '支付渠道最终状态需由案件专员复核。',
      },
      prohibitedActions: [
        '不得把渠道超时解释为交易失败',
        '不得在冲正在途时重复退款',
      ],
      responseDraft:
        '周先生，您好。我们已核实两笔交易均指向同一期还款，系统已自动发起一笔 588.20 元冲正，目前渠道仍在处理中。为避免重复退款，我们会先确认冲正最终状态，再向您反馈后续结果。',
      auditEvents: [
        { at: '11:18:00', actor: '系统', action: '案件进入待调查队列' },
        {
          at: '11:19:04',
          actor: '案件协调 Agent',
          action: '识别为疑似重复扣款',
        },
        { at: '11:19:06', actor: '事实调查 Agent', action: '发现自动冲正在途' },
        { at: '11:19:07', actor: '处置合规 Agent', action: '阻止重复退款建议' },
      ],
    };
  }

  return {
    caseId: caseItem.caseId,
    mode: 'RECORDED',
    coordinator: {
      complaintType: caseItem.expectedType,
      riskLevel: 'HIGH',
      mandatoryEscalation: true,
      summary: '客户否认交易，同时存在陌生设备、异地登录与短时交易聚集。',
    },
    evidence: securityEvidence,
    confirmedFacts: [
      '陌生设备于凌晨在深圳登录。',
      '登录后八分钟内发生三笔交易，共 ¥2,578.00。',
      '客户明确否认相关登录和交易。',
    ],
    conflict: {
      title: '交易是否可直接认定为盗刷',
      resolution:
        '风险信号充分支持强制升级，但在安全团队核验前不得认定交易性质。',
      status: 'UNRESOLVED',
    },
    evidenceGate: 'MANDATORY_ESCALATION',
    recommendation: {
      actionCode: 'ESCALATE_SECURITY',
      action: '立即转交账户安全团队核验',
      amount: 2578,
      rationale:
        '客户否认授权，且同时命中新设备、地点偏离、异常时段和交易聚集风险信号。',
      state: 'MANDATORY_ESCALATION',
      ruleIds: ['RULE-SECURITY-001', 'RULE-SECURITY-002'],
    },
    approval: {
      level: 'SECURITY_TEAM',
      reason: '命中疑似未授权交易强制升级规则。',
    },
    prohibitedActions: [
      '不得确认盗刷已经成立',
      '不得承诺资金一定追回',
      '不得声称账户已经冻结',
    ],
    responseDraft:
      '您好，您的反馈我们已受理。鉴于存在非本人交易陈述及异常登录风险信号，案件已升级至账户安全团队核验。在核验完成前，我们暂不能认定交易性质、责任或资金处理结果，请留意后续人工联系。',
    auditEvents: [
      { at: '08:06:00', actor: '系统', action: '案件进入安全核验队列' },
      {
        at: '08:07:04',
        actor: '案件协调 Agent',
        action: '识别为高风险安全案件',
      },
      {
        at: '08:07:06',
        actor: '事实调查 Agent',
        action: '确认多项账户风险信号',
      },
      { at: '08:07:07', actor: '处置合规 Agent', action: '触发强制升级护栏' },
    ],
  };
}

export function investigateCase(caseId: string): InvestigationResult | null {
  const caseItem = mockDatabase.cases.find((item) => item.caseId === caseId);
  if (!caseItem) return null;

  if (toolPlan.length > 12) {
    throw new Error('工具调用超过单次运行上限');
  }

  const toolTraces = toolPlan.map((tool, index) => {
    const response = runReadOnlyTool(
      tool,
      callArguments(caseItem, tool),
      tool === 'get_customer_profile'
        ? 'case_coordinator'
        : 'fact_rule_investigator',
    );
    return traceToolCall(tool, response, index);
  });

  const disposition = buildDisposition(caseItem);
  return {
    ...disposition,
    runId: `RUN-${caseId.slice(-5)}-001`,
    generatedAt: '2026-09-03T14:30:00+08:00',
    toolTraces,
  };
}

export function listCases() {
  return mockDatabase.cases.map((caseItem) => {
    const customer = mockDatabase.customers.find(
      (item) => item.customerId === caseItem.customerId,
    );
    return {
      ...caseItem,
      customerName: customer?.maskedName ?? '未知客户',
    };
  });
}
