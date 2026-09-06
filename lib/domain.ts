export type CaseType =
  | 'early_repayment_debit'
  | 'duplicate_debit'
  | 'suspected_fraud';

export type MockCase = {
  caseId: string;
  customerId: string;
  loanId: string | null;
  channel: string;
  receivedAt: string;
  rawText: string;
  status: 'PENDING_INVESTIGATION';
  expectedType: CaseType;
  expectedRiskLevel: 'MEDIUM' | 'HIGH';
  customerRequests: string[];
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
  status: 'OK' | 'NOT_FOUND';
  recordCount: number;
  elapsedMs: number;
};

export type Evidence = {
  evidenceId: string;
  evidenceType: string;
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
  mode: 'RECORDED';
  coordinator: {
    complaintType: CaseType;
    riskLevel: 'MEDIUM' | 'HIGH';
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
  evidenceGate: 'SUFFICIENT' | 'MANDATORY_ESCALATION';
  recommendation: {
    actionCode:
      | 'PROPOSE_REFUND'
      | 'WAIT_FOR_REVERSAL'
      | 'ESCALATE_SECURITY';
    action: string;
    amount: number | null;
    rationale: string;
    state: 'PENDING_APPROVAL' | 'NEEDS_INFORMATION' | 'MANDATORY_ESCALATION';
    ruleIds: string[];
  };
  approval: {
    level: 'L1_SUPERVISOR' | 'CASE_SPECIALIST' | 'SECURITY_TEAM';
    reason: string;
  };
  prohibitedActions: string[];
  responseDraft: string;
  auditEvents: Array<{ at: string; actor: string; action: string }>;
};
