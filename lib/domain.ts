export type CaseType =
  | 'early_repayment_debit'
  | 'duplicate_debit'
  | 'suspected_fraud'
  | 'other';

export type InvestigationCase = {
  caseId: string;
  customerId: string;
  loanId: string | null;
  channel: string;
  receivedAt: string;
  rawText: string;
  customerRequests: string[];
};

export type MockCase = InvestigationCase & {
  status: 'PENDING_INVESTIGATION';
  expectedType: CaseType;
  expectedRiskLevel: 'MEDIUM' | 'HIGH';
};

export type ToolName =
  | 'get_customer_profile'
  | 'get_loan_contract'
  | 'get_repayment_plan'
  | 'get_payment_transactions'
  | 'get_early_repayment_requests'
  | 'get_support_tickets'
  | 'get_account_security_events'
  | 'search_rules';

export type ToolTrace = {
  name: ToolName;
  label: string;
  status: 'OK' | 'NOT_FOUND' | 'ERROR';
  recordCount: number;
  elapsedMs: number;
};

export type ProviderMode = 'recorded' | 'openai' | 'glm';

export type ValidationCheck = {
  code: string;
  label: string;
  status: 'PASSED' | 'BLOCKED';
};

export type RuntimeExecution = {
  requestedProvider: ProviderMode;
  actualProvider: ProviderMode;
  model: string | null;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  validationStatus: 'PASSED';
  validationChecks: ValidationCheck[];
};

export type RuntimeCapabilities = {
  defaultProvider: ProviderMode;
  caseDataTransmission: 'paused' | 'allowed';
  glm: {
    configured: boolean;
    available: boolean;
    model: string;
  };
  openai: {
    configured: boolean;
    available: boolean;
    model: string;
  };
};

export type AgentStageId =
  | 'case_coordinator'
  | 'fact_rule_investigator'
  | 'disposition_compliance';

export type InvestigationEvent =
  | { type: 'stage_started'; stageId: AgentStageId; provider: ProviderMode }
  | { type: 'fallback'; reason: string }
  | { type: 'completed'; result: InvestigationResult }
  | { type: 'error'; message: string };

export type AgentRunTrace = {
  stageId: AgentStageId;
  name: string;
  responsibility: string;
  status: 'COMPLETED';
  provider: ProviderMode;
  durationMs: number;
  inputSummary: string[];
  actions: string[];
  outputSummary: string[];
  metrics: {
    toolCalls: number;
    recordCount: number;
    evidenceCount: number;
    ruleCount: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
  technicalDetails: {
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    responseId: string | null;
    omittedFieldCount: number | null;
  };
};

export type EvidenceType =
  | 'CUSTOMER_STATEMENT'
  | 'LOAN_CONTRACT'
  | 'LOAN_STATUS_EVENT'
  | 'REPAYMENT_SCHEDULE'
  | 'PAYMENT_TRANSACTION'
  | 'REVERSAL_TRANSACTION'
  | 'EARLY_REPAYMENT_REQUEST'
  | 'SUPPORT_TICKET'
  | 'ACCOUNT_SECURITY_EVENT'
  | 'RULE_DOCUMENT';

export type Evidence = {
  evidenceId: string;
  evidenceType: EvidenceType;
  sourceSystem: string;
  sourceRecordId: string;
  observedAt: string;
  title: string;
  claim: string;
  rawExcerpt: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
};

export type InvestigationResult = {
  runId: string;
  caseId: string;
  generatedAt: string;
  mode: 'RECORDED' | 'OPENAI' | 'GLM';
  coordinator: {
    complaintType: CaseType;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    mandatoryEscalation: boolean;
    summary: string;
  };
  toolTraces: ToolTrace[];
  evidence: Evidence[];
  confirmedFacts: string[];
  conflict: {
    title: string;
    resolution: string;
    status: 'RESOLVED' | 'UNRESOLVED';
  };
  evidenceGate:
    | 'SUFFICIENT'
    | 'INSUFFICIENT'
    | 'CONFLICT_BLOCKED'
    | 'MANDATORY_ESCALATION';
  recommendation: {
    actionCode:
      | 'PROPOSE_REFUND'
      | 'WAIT_FOR_REVERSAL'
      | 'REQUEST_INFORMATION'
      | 'ESCALATE_SECURITY'
      | 'EXPLAIN_NO_ERROR'
      | 'MANUAL_REVIEW';
    action: string;
    amount: number | null;
    rationale: string;
    state: 'PENDING_APPROVAL' | 'NEEDS_INFORMATION' | 'MANDATORY_ESCALATION';
    ruleIds: string[];
    evidenceIds: string[];
  };
  approval: {
    level:
      | 'L1_SUPERVISOR'
      | 'L2_COMPLIANCE'
      | 'CASE_SPECIALIST'
      | 'SECURITY_TEAM';
    reason: string;
  };
  prohibitedActions: string[];
  auditEvents: Array<{ at: string; actor: string; action: string }>;
  agentRuns: AgentRunTrace[];
  execution: RuntimeExecution;
};

export type ApprovalOutcome = {
  approvalId: string;
  caseId: string;
  status: 'APPROVED';
  completedAt: string;
  decision: string;
  executionStatus: string;
  executionDeadline: string;
  responseDraft: string;
};
