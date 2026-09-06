import type {
  AgentRunTrace,
  CaseType,
  InvestigationCase,
  ProviderMode,
  ToolTrace,
} from '../domain';
import type { ModelCallMetadata } from './model-provider';
import type { InvestigationPayload } from './safety-validator';

const complaintTypeLabels: Record<CaseType, string> = {
  early_repayment_debit: '提前还款后扣款',
  duplicate_debit: '重复扣款',
  suspected_fraud: '疑似未授权交易',
  other: '其他客诉',
};

const riskLabels: Record<
  InvestigationPayload['coordinator']['riskLevel'],
  string
> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  CRITICAL: '严重',
};

const gateLabels: Record<InvestigationPayload['evidenceGate'], string> = {
  SUFFICIENT: '证据充分',
  INSUFFICIENT: '证据不足',
  CONFLICT_BLOCKED: '存在未解冲突',
  MANDATORY_ESCALATION: '已触发强制升级',
};

const approvalLabels: Record<
  InvestigationPayload['approval']['level'],
  string
> = {
  L1_SUPERVISOR: '一级组长审批',
  L2_COMPLIANCE: '二级合规审批',
  CASE_SPECIALIST: '案件专员复核',
  SECURITY_TEAM: '账户安全团队',
};

function sumDuration(traces: ToolTrace[]) {
  return traces.reduce((total, trace) => total + trace.elapsedMs, 0);
}

function sumRecords(traces: ToolTrace[]) {
  return traces.reduce((total, trace) => total + trace.recordCount, 0);
}

function maskReference(value: string | null) {
  if (!value) return null;
  const [prefix = 'REF'] = value.split('-');
  return `${prefix}-••••${value.slice(-4)}`;
}

function modelMetrics(call: ModelCallMetadata | undefined) {
  return {
    inputTokens: call?.inputTokens ?? null,
    outputTokens: call?.outputTokens ?? null,
    responseId: call?.responseId ?? null,
    durationMs: call?.durationMs ?? 0,
    omittedFieldCount: call?.omittedFieldCount ?? null,
  };
}

export function buildAgentRunTraces(options: {
  caseItem: InvestigationCase;
  result: InvestigationPayload;
  provider: ProviderMode;
  modelCalls?: ModelCallMetadata[];
}): AgentRunTrace[] {
  const { caseItem, result, provider, modelCalls = [] } = options;
  const coordinatorCall = modelMetrics(modelCalls[0]);
  const investigatorCall = modelMetrics(modelCalls[1]);
  const dispositionCall = modelMetrics(modelCalls[2]);
  const traces = result.toolTraces;
  const complaintType = complaintTypeLabels[result.coordinator.complaintType];
  const riskLevel = `${riskLabels[result.coordinator.riskLevel]}风险`;
  const ruleIds = result.recommendation.ruleIds;
  const technicalCaseInput = {
    caseId: caseItem.caseId,
    receivedAt: caseItem.receivedAt,
    channel: caseItem.channel,
    customerReference: maskReference(caseItem.customerId),
    businessReference: maskReference(caseItem.loanId),
    complaintText: caseItem.rawText,
  };
  const technicalEvidence = result.evidence.map((item) => ({
    evidenceId: item.evidenceId,
    evidenceType: item.evidenceType,
    sourceSystem: item.sourceSystem,
    sourceRecordId: item.sourceRecordId,
    claim: item.claim,
  }));

  return [
    {
      stageId: 'case_coordinator',
      name: '案件协调 Agent',
      responsibility: '识别诉求、业务类型与风险',
      status: 'COMPLETED',
      provider,
      durationMs: coordinatorCall.durationMs,
      inputSummary: [
        `案件 ${caseItem.caseId}`,
        `渠道 ${caseItem.channel}`,
        `客户诉求 ${caseItem.customerRequests.length} 项`,
      ],
      actions: ['解析客户诉求', '判定业务类型与风险', '生成最小只读调查计划'],
      outputSummary: [
        `业务类型：${complaintType}`,
        `风险等级：${riskLevel}`,
        result.coordinator.mandatoryEscalation
          ? '处理边界：必须升级'
          : `调查计划：${traces.length} 个只读工具`,
      ],
      metrics: {
        toolCalls: 0,
        recordCount: 0,
        evidenceCount: 0,
        ruleCount: 0,
        inputTokens: coordinatorCall.inputTokens,
        outputTokens: coordinatorCall.outputTokens,
      },
      technicalDetails: {
        input: technicalCaseInput,
        output: {
          caseBrief: result.coordinator.summary,
          complaintType: result.coordinator.complaintType,
          riskLevel: result.coordinator.riskLevel,
          mandatoryEscalation: result.coordinator.mandatoryEscalation,
          customerRequests: caseItem.customerRequests,
          plannedTools: traces.map((trace) => trace.name),
        },
        responseId: coordinatorCall.responseId,
        omittedFieldCount: coordinatorCall.omittedFieldCount,
      },
    },
    {
      stageId: 'fact_rule_investigator',
      name: '事实与规则调查 Agent',
      responsibility: '调用只读工具并建立证据链',
      status: 'COMPLETED',
      provider,
      durationMs: investigatorCall.durationMs + sumDuration(traces),
      inputSummary: [
        `业务类型 ${complaintType}`,
        `调查工具 ${traces.length} 个`,
        `返回记录 ${sumRecords(traces)} 条`,
      ],
      actions: [
        `调用 ${traces.length} 个服务端只读工具`,
        `建立 ${result.evidence.length} 项稳定证据引用`,
        `核对 ${ruleIds.length} 项适用规则`,
      ],
      outputSummary: [
        `证据：${result.evidence.length} 项`,
        `已确认事实：${result.confirmedFacts.length} 项`,
        `证据门：${gateLabels[result.evidenceGate]}`,
      ],
      metrics: {
        toolCalls: traces.length,
        recordCount: sumRecords(traces),
        evidenceCount: result.evidence.length,
        ruleCount: ruleIds.length,
        inputTokens: investigatorCall.inputTokens,
        outputTokens: investigatorCall.outputTokens,
      },
      technicalDetails: {
        input: {
          caseId: caseItem.caseId,
          coordinatorDecision: {
            complaintType: result.coordinator.complaintType,
            riskLevel: result.coordinator.riskLevel,
            mandatoryEscalation: result.coordinator.mandatoryEscalation,
          },
          toolResults: traces.map((trace) => ({
            name: trace.name,
            status: trace.status,
            recordCount: trace.recordCount,
            elapsedMs: trace.elapsedMs,
          })),
        },
        output: {
          evidence: technicalEvidence,
          confirmedFacts: result.confirmedFacts,
          conflict: result.conflict,
          evidenceGate: result.evidenceGate,
          ruleIds,
        },
        responseId: investigatorCall.responseId,
        omittedFieldCount: investigatorCall.omittedFieldCount,
      },
    },
    {
      stageId: 'disposition_compliance',
      name: '处置与合规审查 Agent',
      responsibility: '生成受证据门和审批约束的建议',
      status: 'COMPLETED',
      provider,
      durationMs: dispositionCall.durationMs,
      inputSummary: [
        `证据门 ${gateLabels[result.evidenceGate]}`,
        `证据引用 ${result.recommendation.evidenceIds.length} 项`,
        `规则引用 ${ruleIds.length} 项`,
      ],
      actions: [
        '检查证据门与冲突',
        '生成待审批处置建议',
        '应用资金与对客回复护栏',
      ],
      outputSummary: [
        `建议：${result.recommendation.action}`,
        `状态：${result.recommendation.state}`,
        `审批：${approvalLabels[result.approval.level]}`,
      ],
      metrics: {
        toolCalls: 0,
        recordCount: 0,
        evidenceCount: result.recommendation.evidenceIds.length,
        ruleCount: ruleIds.length,
        inputTokens: dispositionCall.inputTokens,
        outputTokens: dispositionCall.outputTokens,
      },
      technicalDetails: {
        input: {
          caseId: caseItem.caseId,
          evidenceGate: result.evidenceGate,
          confirmedFactCount: result.confirmedFacts.length,
          evidenceIds: result.recommendation.evidenceIds,
          ruleIds,
          mandatoryEscalation: result.coordinator.mandatoryEscalation,
        },
        output: {
          recommendation: result.recommendation,
          approvalRequirement: result.approval,
          prohibitedActions: result.prohibitedActions,
          responseConstraint: '审批完成且结论明确后才可生成客户回复',
        },
        responseId: dispositionCall.responseId,
        omittedFieldCount: dispositionCall.omittedFieldCount,
      },
    },
  ];
}
