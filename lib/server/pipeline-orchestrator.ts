import type {
  Evidence,
  InvestigationResult,
  MockCase,
  ProviderMode,
  ToolName,
} from '../domain';
import {
  coordinatorPrompt,
  dispositionPrompt,
  investigatorPrompt,
} from './agent-prompts';
import { buildAgentRunTraces } from './agent-run-traces';
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
  getRuntimeCapabilities,
  OpenAIModelProvider,
  type ModelCallMetadata,
} from './model-provider';
import { mockDatabase } from './mock-database';
import {
  runReadOnlyTool,
  traceToolCall,
  type ToolResponse,
} from './mock-tools';
import { investigateRecordedCase } from './recorded-orchestrator';
import {
  validateInvestigation,
  type InvestigationPayload,
} from './safety-validator';

type PipelineOptions = {
  provider?: ProviderMode;
};

type ToolRun = {
  name: ToolName;
  response: ToolResponse;
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

function deterministicSafetyResult(caseItem: MockCase) {
  const securityLanguage =
    /非本人|不是我|陌生消费|新设备|异地登录|登录不上|盗刷|账户.*接管/.test(
      caseItem.rawText,
    );
  const mandatoryEscalation =
    caseItem.expectedType === 'suspected_fraud' || securityLanguage;
  return {
    mandatoryEscalation,
    reason: mandatoryEscalation
      ? '客户否认授权或存在账户接管风险线索，应用层强制升级。'
      : '未命中必须升级的账户安全硬规则。',
  };
}

function callArguments(caseItem: MockCase, tool: ToolName) {
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
        query: '投诉调查、证据边界与处置审批',
        effectiveAt: caseItem.receivedAt.slice(0, 10),
        businessType: caseItem.expectedType,
      };
  }
}

function buildToolPlan(caseItem: MockCase, coordinator: CoordinatorOutput) {
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

function validContext(toolRuns?: ToolRun[]) {
  const sourceIds = toolRuns
    ? collectRecordIds(toolRuns.map((item) => item.response.data))
    : collectRecordIds(mockDatabase);
  const ruleIds = new Set(
    mockDatabase.rules
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
  return { validSourceRecordIds: sourceIds, validRuleIds: ruleIds };
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
) {
  if (
    !['PROPOSE_REFUND', 'WAIT_FOR_REVERSAL'].includes(
      disposition.recommendation.actionCode,
    )
  ) {
    return null;
  }
  for (const evidenceId of disposition.recommendation.evidenceIds) {
    const evidence = investigator.evidence.find(
      (item) => item.evidenceId === evidenceId,
    );
    const transaction = mockDatabase.transactions.find(
      (item) => item.transactionId === evidence?.sourceRecordId,
    );
    if (transaction) return transaction.amount;
  }
  return null;
}

function assertModelReferences(
  investigator: InvestigatorOutput,
  disposition: DispositionOutput,
  toolRuns: ToolRun[],
) {
  const context = validContext(toolRuns);
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
    throw new Error('模型输出包含不存在的证据引用');
  }
  if (
    investigator.evidence.some(
      (item) => !context.validSourceRecordIds.has(item.sourceRecordId),
    )
  ) {
    throw new Error('模型证据引用了工具结果中不存在的来源记录');
  }
  if (
    investigator.applicableRules.some(
      (item) => !context.validRuleIds.has(item.ruleId),
    ) ||
    disposition.recommendation.ruleIds.some(
      (item) => !context.validRuleIds.has(item),
    )
  ) {
    throw new Error('模型引用了未由规则工具返回的规则');
  }
}

function mapModelResult(
  caseItem: MockCase,
  coordinator: CoordinatorOutput,
  investigator: InvestigatorOutput,
  disposition: DispositionOutput,
  toolRuns: ToolRun[],
): InvestigationPayload {
  const evidence: Evidence[] = investigator.evidence.map((item) => ({
    ...item,
    title: titleForEvidence(item),
    tone: toneForEvidence(item),
  }));
  const conflict = investigator.conflicts[0];
  return {
    runId: `RUN-${caseItem.caseId.slice(-5)}-${Date.now().toString(36).toUpperCase()}`,
    caseId: caseItem.caseId,
    generatedAt: new Date().toISOString(),
    mode: 'OPENAI',
    coordinator: {
      complaintType: coordinator.complaintType,
      riskLevel: coordinator.riskLevel,
      mandatoryEscalation: coordinator.mandatoryEscalation,
      summary: coordinator.caseBrief,
    },
    toolTraces: toolRuns.map((item, index) =>
      traceToolCall(item.name, item.response, index),
    ),
    evidence,
    confirmedFacts: investigator.confirmedFacts.map((item) => item.statement),
    conflict: conflict
      ? {
          title: conflict.description,
          resolution: conflict.nextAction,
          status: conflict.resolution,
        }
      : {
          title: '系统记录与客户主张已完成对照',
          resolution: investigator.evidenceGate.reason,
          status:
            investigator.evidenceGate.status === 'CONFLICT_BLOCKED'
              ? 'UNRESOLVED'
              : 'RESOLVED',
        },
    evidenceGate: investigator.evidenceGate.status,
    recommendation: {
      ...disposition.recommendation,
      amount: amountFromEvidence(disposition, investigator),
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

async function investigateWithOpenAI(caseItem: MockCase) {
  const provider = new OpenAIModelProvider();
  const safety = deterministicSafetyResult(caseItem);
  const calls: ModelCallMetadata[] = [];

  const coordinatorCall = await provider.generateStructured<CoordinatorOutput>({
    stage: 'case_coordinator',
    instructions: coordinatorPrompt,
    input: {
      caseId: caseItem.caseId,
      rawText: caseItem.rawText,
      customerId: caseItem.customerId,
      loanId: caseItem.loanId,
      channel: caseItem.channel,
      receivedAt: caseItem.receivedAt,
      deterministicSafetyResult: safety,
    },
    schemaName: 'case_coordinator_output',
    schema: coordinatorSchema,
  });
  assertCoordinatorOutput(coordinatorCall.output);
  calls.push(coordinatorCall.metadata);

  if (safety.mandatoryEscalation) {
    coordinatorCall.output.mandatoryEscalation = true;
    coordinatorCall.output.riskLevel = 'HIGH';
    coordinatorCall.output.complaintType = 'suspected_fraud';
  }

  const toolPlan = buildToolPlan(caseItem, coordinatorCall.output);
  const toolRuns = toolPlan.map((name) => ({
    name,
    response: runReadOnlyTool(
      name,
      callArguments(caseItem, name),
      name === 'get_customer_profile'
        ? 'case_coordinator'
        : 'fact_rule_investigator',
    ),
  }));

  const investigatorCall =
    await provider.generateStructured<InvestigatorOutput>({
      stage: 'fact_rule_investigator',
      instructions: investigatorPrompt,
      input: {
        case: caseItem,
        coordinator: coordinatorCall.output,
        deterministicSafetyResult: safety,
        toolResults: toolRuns,
      },
      schemaName: 'fact_rule_investigator_output',
      schema: investigatorSchema,
    });
  assertInvestigatorOutput(investigatorCall.output);
  calls.push(investigatorCall.metadata);
  if (safety.mandatoryEscalation) {
    investigatorCall.output.evidenceGate.status = 'MANDATORY_ESCALATION';
    investigatorCall.output.evidenceGate.reason = safety.reason;
  }

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
  });
  assertDispositionOutput(dispositionCall.output);
  calls.push(dispositionCall.metadata);
  assertModelReferences(
    investigatorCall.output,
    dispositionCall.output,
    toolRuns,
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
    ),
    toolRuns,
    model: calls.at(-1)?.model ?? provider.model,
    modelCalls: calls,
  };
}

function withExecution(
  result: InvestigationPayload,
  options: {
    caseItem: MockCase;
    requestedProvider: ProviderMode;
    actualProvider: ProviderMode;
    model: string | null;
    fallbackReason?: string;
    modelCalls?: ModelCallMetadata[];
    toolRuns?: ToolRun[];
  },
): InvestigationResult {
  const validationChecks = validateInvestigation(
    result,
    validContext(options.toolRuns),
  );
  return {
    ...result,
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

  if (requestedProvider === 'openai') {
    try {
      const modelRun = await investigateWithOpenAI(caseItem);
      return withExecution(modelRun.result, {
        caseItem,
        requestedProvider,
        actualProvider: 'openai',
        model: modelRun.model,
        modelCalls: modelRun.modelCalls,
        toolRuns: modelRun.toolRuns,
      });
    } catch {
      const recorded = investigateRecordedCase(caseId);
      if (!recorded) return null;
      const available = getRuntimeCapabilities().openai.available;
      return withExecution(recorded, {
        caseItem,
        requestedProvider,
        actualProvider: 'recorded',
        model: null,
        fallbackReason: available
          ? '模型输出未通过安全校验，已切换稳定模式。'
          : '模型服务尚未启用，已使用稳定模式。',
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
