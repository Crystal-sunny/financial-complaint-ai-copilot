import type {
  Evidence,
  InvestigationCase,
  InvestigationEvent,
  InvestigationResult,
  ProviderMode,
  ToolName,
} from '../domain';
import {
  coordinatorPrompt,
  dispositionPrompt,
  investigatorPrompt,
} from './agent-prompts';
import { buildAgentRunTraces } from './agent-run-traces';
import { assertInvestigationProviderAllowed } from './case-data-policy';
import {
  assertCoordinatorOutput,
  assertDispositionOutput,
  assertInvestigatorOutput,
  coordinatorSchema,
  dispositionSchema,
  investigatorSchema,
  type CoordinatorOutput,
  type DispositionOutput,
  type InvestigatorOutput,
} from './model-contracts';
import {
  createModelProvider,
  ModelProviderError,
  type ModelCallMetadata,
} from './model-provider';
import { mockDatabase } from './mock-database';
import {
  runReadOnlyTool,
  traceToolCall,
  type ToolResponse,
} from './mock-tools';
import { investigateRecordedCase } from './recorded-orchestrator';
import { paymentRecordSemantics } from './tool-semantics';
import {
  InvestigationValidationError,
  validateInvestigation,
  type InvestigationPayload,
} from './safety-validator';

type PipelineOptions = {
  provider?: ProviderMode;
  signal?: AbortSignal;
  onEvent?: (event: InvestigationEvent) => void;
  database?: typeof mockDatabase;
  forcedToolErrors?: ReadonlySet<ToolName>;
};

type ToolRun = {
  name: ToolName;
  response: ToolResponse;
  elapsedMs: number;
};

const requiredToolsByType: Record<string, ToolName[]> = {
  early_repayment_debit: [
    'get_customer_profile',
    'get_loan_contract',
    'get_repayment_plan',
    'get_payment_transactions',
    'get_early_repayment_requests',
    'get_support_tickets',
    'search_rules',
  ],
  duplicate_debit: [
    'get_customer_profile',
    'get_repayment_plan',
    'get_payment_transactions',
    'get_support_tickets',
    'search_rules',
  ],
  suspected_fraud: [
    'get_customer_profile',
    'get_payment_transactions',
    'get_support_tickets',
    'get_account_security_events',
    'search_rules',
  ],
  other: ['get_customer_profile', 'get_support_tickets', 'search_rules'],
};

function deterministicSafetyResult(caseItem: InvestigationCase) {
  const caseLanguage = [caseItem.rawText, ...caseItem.customerRequests].join(
    ' ',
  );
  const ownershipInquiryOnly =
    /(?:确认|核实|查|查看|看看)[^，。；！？]{0,24}(?:是不是|是否)(?:属于)?(?:我|本人)(?:的)?/.test(
      caseLanguage,
    ) &&
    !/(?:^|[^是])不是我|未经(?:我|本人)?授权|未获(?:我|本人)?授权|非本人|陌生消费|新设备|异地登录|登录不上|盗刷|账户.*接管/.test(
      caseLanguage,
    );
  const securityLanguage =
    /非本人|(?:^|[^是])不是我|未经(?:我|本人)?授权|未获(?:我|本人)?授权|陌生消费|新设备|异地登录|登录不上|盗刷|账户.*接管|我.*没有.*(?:进行|操作|消费)|没(?:有)?[^，。]{0,20}(?:点过|付过|买过|操作过|授权过|消费过)|没让.*(?:别人|他人).*(?:操作|进行)|从未.*(?:操作|授权)/.test(
      caseLanguage,
    );
  const mandatoryEscalation = securityLanguage && !ownershipInquiryOnly;
  return {
    mandatoryEscalation,
    ownershipInquiryOnly,
    reason: mandatoryEscalation
      ? '客户否认授权或存在账户接管风险线索，应用层强制升级。'
      : ownershipInquiryOnly
        ? '客户仅询问记录是否属于本人，未明确否认授权，不触发强制安全升级。'
        : '未命中必须升级的账户安全硬规则。',
  };
}

function deterministicComplaintType(
  caseItem: InvestigationCase,
  safety: ReturnType<typeof deterministicSafetyResult>,
): CoordinatorOutput['complaintType'] | null {
  if (safety.mandatoryEscalation) return 'suspected_fraud';
  const caseLanguage = [caseItem.rawText, ...caseItem.customerRequests].join(
    ' ',
  );
  if (
    /重复(?:支付|付款|扣款)|(?:两|2)(?:次|笔)[^，。；！？]{0,24}(?:支付|付款|扣款)|(?:支付|付款|扣款)[^，。；！？]{0,24}(?:两|2)(?:次|笔)|冲正/.test(
      caseLanguage,
    )
  )
    return 'duplicate_debit';
  if (
    caseItem.loanId &&
    /提前(?:还款|结清)|结清|应收|贷款|还款|扣款/.test(caseLanguage)
  )
    return 'early_repayment_debit';
  return null;
}

function enforceInvestigationGate(
  caseItem: InvestigationCase,
  coordinator: CoordinatorOutput,
  investigator: InvestigatorOutput,
  safety: ReturnType<typeof deterministicSafetyResult>,
  availableRuleIds: Set<string>,
  transactionRecords: Array<{
    transactionId: string;
    customerId: string;
    loanId: string | null;
    relatedScheduleId: string | null;
    type: string;
    amount: number;
    status: string;
  }>,
) {
  if (safety.mandatoryEscalation || coordinator.mandatoryEscalation) {
    investigator.evidenceGate.status = 'MANDATORY_ESCALATION';
    investigator.evidenceGate.reason = safety.mandatoryEscalation
      ? safety.reason
      : '案件协调阶段识别到明确安全风险，必须升级安全团队。';
    return;
  }
  if (coordinator.complaintType === 'duplicate_debit') {
    const successfulPayments = transactionRecords.filter(
      (item) =>
        item.customerId === caseItem.customerId &&
        item.loanId === caseItem.loanId &&
        ['MANUAL_REPAYMENT', 'MANUAL_REPAYMENT_RETRY'].includes(item.type) &&
        ['SUCCESS', 'SUCCESS_AFTER_TIMEOUT'].includes(item.status) &&
        item.relatedScheduleId !== null &&
        item.amount > 0,
    );
    const reversals = transactionRecords.filter(
      (item) =>
        item.customerId === caseItem.customerId &&
        item.loanId === caseItem.loanId &&
        item.type === 'AUTOMATIC_REVERSAL' &&
        ['PROCESSING', 'SUCCESS'].includes(item.status) &&
        item.relatedScheduleId !== null &&
        item.amount > 0,
    );
    const hasBoundDuplicate = reversals.some((reversal) => {
      const matchingPayments = successfulPayments.filter(
        (payment) =>
          payment.relatedScheduleId === reversal.relatedScheduleId &&
          payment.amount === reversal.amount,
      );
      return (
        new Set(matchingPayments.map((item) => item.transactionId)).size >= 2
      );
    });
    if (!hasBoundDuplicate) {
      investigator.evidenceGate.status = 'INSUFFICIENT';
      investigator.evidenceGate.reason =
        '未检索到两笔同客户、同贷款、同应收、同金额的最终成功付款及匹配冲正。';
      const field = 'duplicate_transaction_relationship';
      if (!investigator.missingInformation.some((item) => item.field === field))
        investigator.missingInformation.push({
          field,
          reason: '现有交易记录不足以确认重复扣款与冲正关系。',
          nextAction: '补查交易终态、应收关联、金额及冲正归属。',
        });
    }
  }
  const requiredRules =
    coordinator.complaintType === 'early_repayment_debit'
      ? ['RULE-PAY-004', 'RULE-APPROVAL-002']
      : coordinator.complaintType === 'duplicate_debit'
        ? ['RULE-PAY-005']
        : [];
  const missingRules = requiredRules.filter(
    (ruleId) => !availableRuleIds.has(ruleId),
  );
  if (!missingRules.length) return;
  investigator.evidenceGate.status = 'INSUFFICIENT';
  investigator.evidenceGate.reason = `处置所需规则未完整检索：${missingRules.join('、')}。`;
  const field = `rules:${missingRules.join(',')}`;
  if (!investigator.missingInformation.some((item) => item.field === field))
    investigator.missingInformation.push({
      field,
      reason: '缺少受理时点有效的动作授权或审批规则。',
      nextAction: '补查当前有效规则后再形成资金处置建议。',
    });
}

function callArguments(
  caseItem: InvestigationCase,
  tool: ToolName,
  businessType: CoordinatorOutput['complaintType'],
) {
  switch (tool) {
    case 'get_customer_profile':
      return { customerId: caseItem.customerId };
    case 'get_loan_contract':
    case 'get_repayment_plan':
    case 'get_early_repayment_requests':
      return {
        customerId: caseItem.customerId,
        loanId: caseItem.loanId,
      };
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
        query: '投诉调查、证据边界与处置审批',
        effectiveAt: caseItem.receivedAt.slice(0, 10),
        businessType,
      };
  }
}

function buildToolPlan(
  caseItem: InvestigationCase,
  coordinator: CoordinatorOutput,
) {
  const planned = coordinator.investigationPlan.map((item) => item.tool);
  const required = requiredToolsByType[coordinator.complaintType] ?? [];
  const tools = [...new Set([...planned, ...required])].filter((tool) => {
    if (caseItem.loanId) return true;
    return ![
      'get_loan_contract',
      'get_repayment_plan',
      'get_early_repayment_requests',
    ].includes(tool);
  });
  if (tools.length > 12) throw new Error('工具调用超过单次运行上限');
  return tools;
}

function collectRecordIds(value: unknown, ids = new Set<string>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectRecordIds(item, ids);
    return ids;
  }
  if (!value || typeof value !== 'object') return ids;
  for (const [key, item] of Object.entries(value)) {
    if (
      typeof item === 'string' &&
      (key === 'ruleId' || key === 'recordId' || key.endsWith('Id'))
    ) {
      ids.add(item);
    }
    collectRecordIds(item, ids);
  }
  return ids;
}

function validContext(
  caseItem: InvestigationCase,
  toolRuns?: ToolRun[],
  database: typeof mockDatabase = mockDatabase,
) {
  const sourceIds = toolRuns
    ? collectRecordIds(toolRuns.map((item) => item.response.data))
    : collectRecordIds(database);
  const ruleIds = new Set(
    database.rules
      .map((item) => item.ruleId)
      .filter((ruleId) =>
        toolRuns
          ? toolRuns.some(
              (run) =>
                run.name === 'search_rules' &&
                JSON.stringify(run.response.data).includes(ruleId),
            )
          : true,
      ),
  );
  const transactionRecords = toolRuns
    ? toolRuns.flatMap((run) =>
        run.name === 'get_payment_transactions' &&
        run.response.status === 'OK' &&
        Array.isArray(run.response.data)
          ? run.response.data
          : [],
      )
    : database.transactions;
  return {
    validSourceRecordIds: sourceIds,
    validRuleIds: ruleIds,
    currentCustomerId: caseItem.customerId,
    currentLoanId: caseItem.loanId,
    transactionRecords,
  };
}

function toneForEvidence(item: InvestigatorOutput['evidence'][number]) {
  const value = `${item.claim} ${item.rawExcerpt}`;
  if (/异常|失败|超时|陌生|未授权|风险|扣款成功/.test(value)) return 'bad';
  if (/处理中|待核验|申请已提交/.test(value)) return 'warn';
  if (/成功|结清|完成|已取消/.test(value)) return 'good';
  return 'neutral';
}

function titleForEvidence(item: InvestigatorOutput['evidence'][number]) {
  const labels: Record<string, string> = {
    CUSTOMER_STATEMENT: '客户原始陈述',
    LOAN_CONTRACT: '贷款合同记录',
    LOAN_STATUS_EVENT: '贷款状态事件',
    REPAYMENT_SCHEDULE: '还款计划记录',
    PAYMENT_TRANSACTION: '支付交易记录',
    REVERSAL_TRANSACTION: '冲正交易记录',
    EARLY_REPAYMENT_REQUEST: '提前还款申请',
    SUPPORT_TICKET: '客服工单记录',
    ACCOUNT_SECURITY_EVENT: '账户安全事件',
    RULE_DOCUMENT: '适用规则',
  };
  return labels[item.evidenceType] ?? item.claim.slice(0, 20);
}

function amountFromEvidence(
  disposition: DispositionOutput,
  investigator: InvestigatorOutput,
  database: typeof mockDatabase = mockDatabase,
) {
  if (
    !['PROPOSE_REFUND', 'WAIT_FOR_REVERSAL'].includes(
      disposition.recommendation.actionCode,
    )
  ) {
    return null;
  }
  const citedSources = new Set(
    investigator.evidence
      .filter((item) =>
        disposition.recommendation.evidenceIds.includes(item.evidenceId),
      )
      .map((item) => item.sourceRecordId),
  );
  const amounts = new Set(
    database.transactions
      .filter(
        (item) =>
          citedSources.has(item.transactionId) &&
          (disposition.recommendation.actionCode === 'WAIT_FOR_REVERSAL'
            ? item.type === 'AUTOMATIC_REVERSAL' && item.status === 'PROCESSING'
            : ['SCHEDULED_DEBIT', 'MANUAL_REPAYMENT_RETRY'].includes(
                item.type,
              ) && ['SUCCESS', 'SUCCESS_AFTER_TIMEOUT'].includes(item.status)),
      )
      .map((item) => item.amount),
  );
  // Never mistake the full early-repayment amount for the disputed later debit.
  return amounts.size === 1 ? Array.from(amounts)[0] : null;
}

function assertModelReferences(
  caseItem: InvestigationCase,
  investigator: InvestigatorOutput,
  disposition: DispositionOutput,
  toolRuns: ToolRun[],
  database: typeof mockDatabase = mockDatabase,
) {
  const context = validContext(caseItem, toolRuns, database);
  const evidenceIds = new Set(
    investigator.evidence.map((item) => item.evidenceId),
  );
  const citedEvidenceIds = [
    ...investigator.timeline.flatMap((item) => item.evidenceIds),
    ...investigator.confirmedFacts.flatMap((item) => item.evidenceIds),
    ...investigator.customerStatements.flatMap((item) => item.evidenceIds),
    ...investigator.conflicts.flatMap((item) => [
      ...item.leftEvidenceIds,
      ...item.rightEvidenceIds,
    ]),
    ...investigator.applicableRules.flatMap((item) => item.evidenceIds),
    ...disposition.rootCauseHypotheses.flatMap((item) => [
      ...item.supportingEvidenceIds,
      ...item.counterEvidenceIds,
    ]),
    ...disposition.recommendation.evidenceIds,
  ];
  if (citedEvidenceIds.some((item) => !evidenceIds.has(item))) {
    throw new InvestigationValidationError(
      '模型输出包含不存在的证据引用',
      'MODEL_EVIDENCE_REFERENCE',
    );
  }
  if (
    investigator.evidence.some(
      (item) => !context.validSourceRecordIds.has(item.sourceRecordId),
    )
  ) {
    throw new InvestigationValidationError(
      '模型证据引用了工具结果中不存在的来源记录',
      'MODEL_SOURCE_REFERENCE',
    );
  }
  if (
    investigator.applicableRules.some(
      (item) => !context.validRuleIds.has(item.ruleId),
    ) ||
    disposition.recommendation.ruleIds.some(
      (item) => !context.validRuleIds.has(item),
    )
  ) {
    throw new InvestigationValidationError(
      '模型引用了未由规则工具返回的规则',
      'MODEL_RULE_REFERENCE',
    );
  }
}

function mapModelResult(
  caseItem: InvestigationCase,
  coordinator: CoordinatorOutput,
  investigator: InvestigatorOutput,
  disposition: DispositionOutput,
  toolRuns: ToolRun[],
  providerMode: Exclude<ProviderMode, 'recorded'>,
  database: typeof mockDatabase = mockDatabase,
): InvestigationPayload {
  const evidence: Evidence[] = investigator.evidence.map((item) => ({
    ...item,
    title: titleForEvidence(item),
    tone: toneForEvidence(item),
  }));
  // Do not hide a later unresolved conflict behind the first resolved item.
  const conflict =
    investigator.conflicts.find((item) => item.resolution === 'UNRESOLVED') ??
    investigator.conflicts[0];
  const evidenceIsSufficient =
    investigator.evidenceGate.status === 'SUFFICIENT';
  return {
    runId: `RUN-${caseItem.caseId.slice(-5)}-${Date.now().toString(36).toUpperCase()}`,
    caseId: caseItem.caseId,
    generatedAt: new Date().toISOString(),
    mode: providerMode === 'glm' ? 'GLM' : 'OPENAI',
    coordinator: {
      complaintType: coordinator.complaintType,
      riskLevel: coordinator.riskLevel,
      mandatoryEscalation: coordinator.mandatoryEscalation,
      summary: coordinator.caseBrief,
    },
    toolTraces: toolRuns.map((item, index) => ({
      ...traceToolCall(item.name, item.response, index),
      elapsedMs: item.elapsedMs,
    })),
    evidence,
    confirmedFacts: investigator.confirmedFacts.map((item) => item.statement),
    conflict: conflict
      ? {
          title: conflict.description,
          resolution: conflict.nextAction,
          status: conflict.resolution,
        }
      : {
          title: evidenceIsSufficient
            ? '系统记录与客户主张已完成对照'
            : '调查结论仍需补充核验',
          resolution: investigator.evidenceGate.reason,
          status: evidenceIsSufficient ? 'RESOLVED' : 'UNRESOLVED',
        },
    evidenceGate: investigator.evidenceGate.status,
    recommendation: {
      ...disposition.recommendation,
      amount: amountFromEvidence(disposition, investigator, database),
    },
    approval: {
      level: disposition.approvalRequirement.level,
      reason: disposition.approvalRequirement.reason,
    },
    prohibitedActions: disposition.prohibitedActions,
    auditEvents: [
      { at: '运行中', actor: '案件协调 Agent', action: '生成最小只读调查计划' },
      {
        at: '运行中',
        actor: '事实调查 Agent',
        action: `核验 ${toolRuns.length} 类业务记录并建立证据链`,
      },
      {
        at: '运行中',
        actor: '处置合规 Agent',
        action: '生成受证据门约束的待审批建议',
      },
      { at: '完成', actor: '应用安全层', action: '完成结构化输出与引用校验' },
    ],
  };
}

async function investigateWithModel(
  caseItem: InvestigationCase,
  providerMode: Exclude<ProviderMode, 'recorded'>,
  options: PipelineOptions,
) {
  const database = options.database ?? mockDatabase;
  const provider = createModelProvider(providerMode);
  const safety = deterministicSafetyResult(caseItem);
  const calls: ModelCallMetadata[] = [];
  const caseContext = {
    caseId: caseItem.caseId,
    rawText: caseItem.rawText,
    customerRequests: caseItem.customerRequests,
    customerId: caseItem.customerId,
    loanId: caseItem.loanId,
    channel: caseItem.channel,
    receivedAt: caseItem.receivedAt,
  };
  const startStage = (
    stageId:
      | 'case_coordinator'
      | 'fact_rule_investigator'
      | 'disposition_compliance',
  ) => {
    options.signal?.throwIfAborted();
    options.onEvent?.({
      type: 'stage_started',
      stageId,
      provider: providerMode,
    });
  };

  startStage('case_coordinator');
  const coordinatorCall = await provider.generateStructured<CoordinatorOutput>({
    stage: 'case_coordinator',
    instructions: coordinatorPrompt,
    input: {
      ...caseContext,
      deterministicSafetyResult: safety,
    },
    schemaName: 'case_coordinator_output',
    schema: coordinatorSchema,
    signal: options.signal,
  });
  assertCoordinatorOutput(coordinatorCall.output);
  calls.push(coordinatorCall.metadata);

  const routedComplaintType = deterministicComplaintType(caseItem, safety);
  if (routedComplaintType)
    coordinatorCall.output.complaintType = routedComplaintType;
  if (safety.mandatoryEscalation) {
    coordinatorCall.output.mandatoryEscalation = true;
    coordinatorCall.output.riskLevel = 'HIGH';
    coordinatorCall.output.complaintType = 'suspected_fraud';
  } else if (safety.ownershipInquiryOnly) {
    coordinatorCall.output.mandatoryEscalation = false;
  }

  startStage('fact_rule_investigator');
  const toolPlan = buildToolPlan(caseItem, coordinatorCall.output);
  const toolRuns = toolPlan.map((name) => {
    const startedAt = performance.now();
    const response = options.forcedToolErrors?.has(name)
      ? {
          status: 'ERROR' as const,
          data: null,
          error: '评测注入的只读工具故障。',
        }
      : runReadOnlyTool(
          name,
          callArguments(caseItem, name, coordinatorCall.output.complaintType),
          name === 'get_customer_profile'
            ? 'case_coordinator'
            : 'fact_rule_investigator',
          database,
        );
    return {
      name,
      response,
      elapsedMs: Math.max(0, Math.round(performance.now() - startedAt)),
    };
  });

  const investigatorCall =
    await provider.generateStructured<InvestigatorOutput>({
      stage: 'fact_rule_investigator',
      instructions: investigatorPrompt,
      input: {
        case: caseContext,
        coordinator: coordinatorCall.output,
        deterministicSafetyResult: safety,
        toolResults: toolRuns,
        recordSemantics: toolRuns.some(
          (run) => run.name === 'get_payment_transactions',
        )
          ? paymentRecordSemantics
          : undefined,
        allowedSourceRecordIds: Array.from(
          validContext(caseItem, toolRuns, database).validSourceRecordIds,
        ),
        allowedRuleIds: Array.from(
          validContext(caseItem, toolRuns, database).validRuleIds,
        ),
      },
      schemaName: 'fact_rule_investigator_output',
      schema: investigatorSchema,
      signal: options.signal,
    });
  assertInvestigatorOutput(investigatorCall.output);
  calls.push(investigatorCall.metadata);
  const validationContext = validContext(caseItem, toolRuns, database);
  enforceInvestigationGate(
    caseItem,
    coordinatorCall.output,
    investigatorCall.output,
    safety,
    validationContext.validRuleIds,
    validationContext.transactionRecords,
  );

  startStage('disposition_compliance');
  const dispositionCall = await provider.generateStructured<DispositionOutput>({
    stage: 'disposition_compliance',
    instructions: dispositionPrompt,
    input: {
      case: {
        caseId: caseItem.caseId,
        rawText: caseItem.rawText,
      },
      investigation: investigatorCall.output,
      deterministicSafetyResult: safety,
    },
    schemaName: 'disposition_compliance_output',
    schema: dispositionSchema,
    signal: options.signal,
  });
  assertDispositionOutput(dispositionCall.output);
  calls.push(dispositionCall.metadata);
  assertModelReferences(
    caseItem,
    investigatorCall.output,
    dispositionCall.output,
    toolRuns,
    database,
  );

  const requiredApprovalFields =
    dispositionCall.output.responseConstraints.requiredApprovalFields;
  if (
    requiredApprovalFields.join('|') !==
    ['decision', 'completedAt', 'executionDeadline'].join('|')
  ) {
    throw new Error('模型未保留审批后生成回复的必需字段');
  }

  return {
    result: mapModelResult(
      caseItem,
      coordinatorCall.output,
      investigatorCall.output,
      dispositionCall.output,
      toolRuns,
      providerMode,
      database,
    ),
    toolRuns,
    model: calls.at(-1)?.model ?? provider.model,
    modelCalls: calls,
  };
}

function withExecution(
  result: InvestigationPayload,
  options: {
    caseItem: InvestigationCase;
    requestedProvider: ProviderMode;
    actualProvider: ProviderMode;
    model: string | null;
    fallbackReason?: string;
    modelCalls?: ModelCallMetadata[];
    toolRuns?: ToolRun[];
    database?: typeof mockDatabase;
  },
): InvestigationResult {
  const validationChecks = validateInvestigation(
    result,
    validContext(options.caseItem, options.toolRuns, options.database),
  );
  return {
    ...result,
    runId: `RUN-${options.caseItem.caseId.slice(-5)}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    agentRuns: buildAgentRunTraces({
      caseItem: options.caseItem,
      result,
      provider: options.actualProvider,
      modelCalls: options.modelCalls,
    }),
    execution: {
      requestedProvider: options.requestedProvider,
      actualProvider: options.actualProvider,
      model: options.model,
      fallbackUsed: Boolean(options.fallbackReason),
      fallbackReason: options.fallbackReason ?? null,
      validationStatus: 'PASSED',
      validationChecks,
    },
  };
}

export async function investigateCase(
  caseId: string,
  options: PipelineOptions = {},
): Promise<InvestigationResult | null> {
  const caseItem = mockDatabase.cases.find((item) => item.caseId === caseId);
  if (!caseItem) return null;
  const requestedProvider = options.provider ?? 'recorded';
  assertInvestigationProviderAllowed(requestedProvider, caseId);
  options.signal?.throwIfAborted();

  if (requestedProvider !== 'recorded') {
    try {
      const modelRun = await investigateWithModel(
        caseItem,
        requestedProvider,
        options,
      );
      return withExecution(modelRun.result, {
        caseItem,
        requestedProvider,
        actualProvider: requestedProvider,
        model: modelRun.model,
        modelCalls: modelRun.modelCalls,
        toolRuns: modelRun.toolRuns,
        database: options.database,
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      const recorded = investigateRecordedCase(caseId);
      if (!recorded) return null;
      const fallbackReason =
        error instanceof ModelProviderError
          ? `${error.message}${error.diagnostic ? `（${error.diagnostic}）` : ''}，已切换稳定模式。`
          : error instanceof InvestigationValidationError
            ? `${error.message}（${error.code}），已切换稳定模式。`
            : '模型输出未通过安全校验，已切换稳定模式。';
      options.onEvent?.({ type: 'fallback', reason: fallbackReason });
      return withExecution(recorded, {
        caseItem,
        requestedProvider,
        actualProvider: 'recorded',
        model: null,
        fallbackReason,
      });
    }
  }

  const recorded = investigateRecordedCase(caseId);
  if (!recorded) return null;
  return withExecution(recorded, {
    caseItem,
    requestedProvider,
    actualProvider: 'recorded',
    model: null,
  });
}

// Server-internal evaluation entrypoint. It has no route and no recorded
// fallback, so a failed model run cannot be mistaken for a successful answer.
export async function investigateSyntheticCaseForEvaluation(
  caseItem: InvestigationCase,
  database: typeof mockDatabase,
  forcedToolErrors: readonly ToolName[] = [],
  options: Pick<PipelineOptions, 'signal' | 'onEvent'> = {},
) {
  assertInvestigationProviderAllowed('glm', caseItem.caseId);
  const modelRun = await investigateWithModel(caseItem, 'glm', {
    ...options,
    database,
    forcedToolErrors: new Set(forcedToolErrors),
  });
  return withExecution(modelRun.result, {
    caseItem,
    requestedProvider: 'glm',
    actualProvider: 'glm',
    model: modelRun.model,
    modelCalls: modelRun.modelCalls,
    toolRuns: modelRun.toolRuns,
    database,
  });
}
