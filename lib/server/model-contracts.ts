import type { CaseType, EvidenceType, ToolName } from '../domain';

export type CoordinatorOutput = {
  caseBrief: string;
  complaintType: CaseType | 'other';
  customerRequests: string[];
  keyEntities: Array<{
    type: string;
    value: string;
    source: 'complaint' | 'case_context';
  }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskSignals: Array<{
    code: string;
    reason: string;
    source: 'complaint' | 'case_context' | 'deterministic_rule';
  }>;
  mandatoryEscalation: boolean;
  investigationPlan: Array<{
    step: number;
    goal: string;
    tool: ToolName;
    required: boolean;
    reason: string;
  }>;
};

export type InvestigatorOutput = {
  evidence: Array<{
    evidenceId: string;
    evidenceType: EvidenceType;
    sourceSystem: string;
    sourceRecordId: string;
    observedAt: string;
    claim: string;
    rawExcerpt: string;
  }>;
  timeline: Array<{
    occurredAt: string;
    event: string;
    evidenceIds: string[];
  }>;
  confirmedFacts: Array<{ statement: string; evidenceIds: string[] }>;
  customerStatements: Array<{
    statement: string;
    verificationStatus:
      | 'SUPPORTED'
      | 'PARTIALLY_SUPPORTED'
      | 'CONTRADICTED'
      | 'UNVERIFIED';
    evidenceIds: string[];
  }>;
  conflicts: Array<{
    description: string;
    leftEvidenceIds: string[];
    rightEvidenceIds: string[];
    resolution: 'UNRESOLVED' | 'RESOLVED';
    nextAction: string;
  }>;
  missingInformation: Array<{
    field: string;
    reason: string;
    nextAction: string;
  }>;
  applicableRules: Array<{
    ruleId: string;
    version: string;
    effectiveFrom: string;
    clause: string;
    applicability: string;
    evidenceIds: string[];
  }>;
  evidenceGate: {
    status:
      | 'SUFFICIENT'
      | 'INSUFFICIENT'
      | 'CONFLICT_BLOCKED'
      | 'MANDATORY_ESCALATION';
    reason: string;
  };
};

export type DispositionOutput = {
  rootCauseHypotheses: Array<{
    hypothesis: string;
    supportingEvidenceIds: string[];
    counterEvidenceIds: string[];
    status: 'SUPPORTED' | 'PLAUSIBLE' | 'UNRESOLVED';
  }>;
  recommendation: {
    actionCode:
      | 'PROPOSE_REFUND'
      | 'WAIT_FOR_REVERSAL'
      | 'REQUEST_INFORMATION'
      | 'ESCALATE_SECURITY'
      | 'EXPLAIN_NO_ERROR'
      | 'MANUAL_REVIEW';
    action: string;
    rationale: string;
    ruleIds: string[];
    evidenceIds: string[];
    state: 'NEEDS_INFORMATION' | 'PENDING_APPROVAL' | 'MANDATORY_ESCALATION';
  };
  approvalRequirement: {
    required: true;
    level:
      | 'L1_SUPERVISOR'
      | 'L2_COMPLIANCE'
      | 'SECURITY_TEAM'
      | 'CASE_SPECIALIST';
    reason: string;
  };
  prohibitedActions: string[];
  responseConstraints: {
    generateAfterApproval: true;
    requiredApprovalFields: ['decision', 'completedAt', 'executionDeadline'];
    prohibitedCustomerTerms: string[];
  };
};

type JsonSchema = Record<string, unknown>;

const toolNames = [
  'get_customer_profile',
  'get_loan_contract',
  'get_repayment_plan',
  'get_payment_transactions',
  'get_early_repayment_requests',
  'get_support_tickets',
  'get_account_security_events',
  'search_rules',
] as const satisfies readonly ToolName[];

const stringArray = {
  type: 'array',
  items: { type: 'string' },
} as const;

const evidenceIdArray = {
  type: 'array',
  items: { type: 'string', pattern: '^E-' },
} as const;

export const coordinatorSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'caseBrief',
    'complaintType',
    'customerRequests',
    'keyEntities',
    'riskLevel',
    'riskSignals',
    'mandatoryEscalation',
    'investigationPlan',
  ],
  properties: {
    caseBrief: { type: 'string', minLength: 1 },
    complaintType: {
      type: 'string',
      enum: [
        'early_repayment_debit',
        'duplicate_debit',
        'suspected_fraud',
        'other',
      ],
    },
    customerRequests: { ...stringArray, minItems: 1 },
    keyEntities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'value', 'source'],
        properties: {
          type: { type: 'string' },
          value: { type: 'string' },
          source: { type: 'string', enum: ['complaint', 'case_context'] },
        },
      },
    },
    riskLevel: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    },
    riskSignals: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['code', 'reason', 'source'],
        properties: {
          code: { type: 'string' },
          reason: { type: 'string' },
          source: {
            type: 'string',
            enum: ['complaint', 'case_context', 'deterministic_rule'],
          },
        },
      },
    },
    mandatoryEscalation: { type: 'boolean' },
    investigationPlan: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['step', 'goal', 'tool', 'required', 'reason'],
        properties: {
          step: { type: 'integer', minimum: 1 },
          goal: { type: 'string', minLength: 1 },
          tool: { type: 'string', enum: toolNames },
          required: { type: 'boolean' },
          reason: { type: 'string', minLength: 1 },
        },
      },
    },
  },
};

export const investigatorSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'evidence',
    'timeline',
    'confirmedFacts',
    'customerStatements',
    'conflicts',
    'missingInformation',
    'applicableRules',
    'evidenceGate',
  ],
  properties: {
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'evidenceId',
          'evidenceType',
          'sourceSystem',
          'sourceRecordId',
          'observedAt',
          'claim',
          'rawExcerpt',
        ],
        properties: {
          evidenceId: { type: 'string', pattern: '^E-' },
          evidenceType: {
            type: 'string',
            enum: [
              'CUSTOMER_STATEMENT',
              'LOAN_CONTRACT',
              'LOAN_STATUS_EVENT',
              'REPAYMENT_SCHEDULE',
              'PAYMENT_TRANSACTION',
              'REVERSAL_TRANSACTION',
              'EARLY_REPAYMENT_REQUEST',
              'SUPPORT_TICKET',
              'ACCOUNT_SECURITY_EVENT',
              'RULE_DOCUMENT',
            ],
          },
          sourceSystem: { type: 'string' },
          sourceRecordId: { type: 'string' },
          observedAt: { type: 'string' },
          claim: { type: 'string', minLength: 1 },
          rawExcerpt: { type: 'string', minLength: 1 },
        },
      },
    },
    timeline: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['occurredAt', 'event', 'evidenceIds'],
        properties: {
          occurredAt: { type: 'string' },
          event: { type: 'string' },
          evidenceIds: { ...evidenceIdArray, minItems: 1 },
        },
      },
    },
    confirmedFacts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'evidenceIds'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          evidenceIds: { ...evidenceIdArray, minItems: 1 },
        },
      },
    },
    customerStatements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'verificationStatus', 'evidenceIds'],
        properties: {
          statement: { type: 'string' },
          verificationStatus: {
            type: 'string',
            enum: [
              'SUPPORTED',
              'PARTIALLY_SUPPORTED',
              'CONTRADICTED',
              'UNVERIFIED',
            ],
          },
          evidenceIds: evidenceIdArray,
        },
      },
    },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'description',
          'leftEvidenceIds',
          'rightEvidenceIds',
          'resolution',
          'nextAction',
        ],
        properties: {
          description: { type: 'string' },
          leftEvidenceIds: evidenceIdArray,
          rightEvidenceIds: evidenceIdArray,
          resolution: { type: 'string', enum: ['UNRESOLVED', 'RESOLVED'] },
          nextAction: { type: 'string' },
        },
      },
    },
    missingInformation: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'reason', 'nextAction'],
        properties: {
          field: { type: 'string' },
          reason: { type: 'string' },
          nextAction: { type: 'string' },
        },
      },
    },
    applicableRules: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'ruleId',
          'version',
          'effectiveFrom',
          'clause',
          'applicability',
          'evidenceIds',
        ],
        properties: {
          ruleId: { type: 'string', pattern: '^RULE-' },
          version: { type: 'string' },
          effectiveFrom: { type: 'string' },
          clause: { type: 'string' },
          applicability: { type: 'string' },
          evidenceIds: evidenceIdArray,
        },
      },
    },
    evidenceGate: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason'],
      properties: {
        status: {
          type: 'string',
          enum: [
            'SUFFICIENT',
            'INSUFFICIENT',
            'CONFLICT_BLOCKED',
            'MANDATORY_ESCALATION',
          ],
        },
        reason: { type: 'string' },
      },
    },
  },
};

export const dispositionSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'rootCauseHypotheses',
    'recommendation',
    'approvalRequirement',
    'prohibitedActions',
    'responseConstraints',
  ],
  properties: {
    rootCauseHypotheses: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'hypothesis',
          'supportingEvidenceIds',
          'counterEvidenceIds',
          'status',
        ],
        properties: {
          hypothesis: { type: 'string' },
          supportingEvidenceIds: evidenceIdArray,
          counterEvidenceIds: evidenceIdArray,
          status: {
            type: 'string',
            enum: ['SUPPORTED', 'PLAUSIBLE', 'UNRESOLVED'],
          },
        },
      },
    },
    recommendation: {
      type: 'object',
      additionalProperties: false,
      required: [
        'actionCode',
        'action',
        'rationale',
        'ruleIds',
        'evidenceIds',
        'state',
      ],
      properties: {
        actionCode: {
          type: 'string',
          enum: [
            'PROPOSE_REFUND',
            'WAIT_FOR_REVERSAL',
            'REQUEST_INFORMATION',
            'ESCALATE_SECURITY',
            'EXPLAIN_NO_ERROR',
            'MANUAL_REVIEW',
          ],
        },
        action: { type: 'string' },
        rationale: { type: 'string' },
        ruleIds: {
          type: 'array',
          items: { type: 'string', pattern: '^RULE-' },
        },
        evidenceIds: evidenceIdArray,
        state: {
          type: 'string',
          enum: [
            'NEEDS_INFORMATION',
            'PENDING_APPROVAL',
            'MANDATORY_ESCALATION',
          ],
        },
      },
    },
    approvalRequirement: {
      type: 'object',
      additionalProperties: false,
      required: ['required', 'level', 'reason'],
      properties: {
        required: { type: 'boolean', const: true },
        level: {
          type: 'string',
          enum: [
            'L1_SUPERVISOR',
            'L2_COMPLIANCE',
            'SECURITY_TEAM',
            'CASE_SPECIALIST',
          ],
        },
        reason: { type: 'string' },
      },
    },
    prohibitedActions: { ...stringArray, minItems: 1 },
    responseConstraints: {
      type: 'object',
      additionalProperties: false,
      required: [
        'generateAfterApproval',
        'requiredApprovalFields',
        'prohibitedCustomerTerms',
      ],
      properties: {
        generateAfterApproval: { type: 'boolean', const: true },
        requiredApprovalFields: {
          type: 'array',
          minItems: 3,
          maxItems: 3,
          prefixItems: [
            { const: 'decision' },
            { const: 'completedAt' },
            { const: 'executionDeadline' },
          ],
          items: false,
        },
        prohibitedCustomerTerms: { ...stringArray, minItems: 1 },
      },
    },
  },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string) {
  if (!isObject(value)) throw new Error(`${label} 不是对象`);
  return value;
}

function requireArray(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} 不是数组`);
  return value;
}

export function assertCoordinatorOutput(
  value: unknown,
): asserts value is CoordinatorOutput {
  const output = requireObject(value, '案件协调输出');
  if (
    ![
      'early_repayment_debit',
      'duplicate_debit',
      'suspected_fraud',
      'other',
    ].includes(String(output.complaintType)) ||
    !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(String(output.riskLevel)) ||
    typeof output.mandatoryEscalation !== 'boolean'
  ) {
    throw new Error('案件协调输出枚举值无效');
  }
  for (const planItem of requireArray(
    output.investigationPlan,
    'investigationPlan',
  )) {
    const item = requireObject(planItem, '调查步骤');
    if (!toolNames.includes(item.tool as ToolName)) {
      throw new Error(`调查计划包含未授权工具：${String(item.tool)}`);
    }
  }
  requireArray(output.customerRequests, 'customerRequests');
  requireArray(output.keyEntities, 'keyEntities');
  requireArray(output.riskSignals, 'riskSignals');
}

export function assertInvestigatorOutput(
  value: unknown,
): asserts value is InvestigatorOutput {
  const output = requireObject(value, '事实调查输出');
  const gate = requireObject(output.evidenceGate, 'evidenceGate');
  if (
    ![
      'SUFFICIENT',
      'INSUFFICIENT',
      'CONFLICT_BLOCKED',
      'MANDATORY_ESCALATION',
    ].includes(String(gate.status))
  ) {
    throw new Error('证据门状态无效');
  }
  for (const item of requireArray(output.evidence, 'evidence')) {
    const evidence = requireObject(item, '证据');
    if (
      !String(evidence.evidenceId).startsWith('E-') ||
      !String(evidence.sourceRecordId)
    ) {
      throw new Error('证据缺少稳定 ID 或来源记录 ID');
    }
  }
  for (const field of [
    'timeline',
    'confirmedFacts',
    'customerStatements',
    'conflicts',
    'missingInformation',
    'applicableRules',
  ]) {
    requireArray(output[field], field);
  }
}

export function assertDispositionOutput(
  value: unknown,
): asserts value is DispositionOutput {
  const output = requireObject(value, '处置合规输出');
  const recommendation = requireObject(output.recommendation, 'recommendation');
  const approval = requireObject(
    output.approvalRequirement,
    'approvalRequirement',
  );
  const response = requireObject(
    output.responseConstraints,
    'responseConstraints',
  );
  if (
    ![
      'PROPOSE_REFUND',
      'WAIT_FOR_REVERSAL',
      'REQUEST_INFORMATION',
      'ESCALATE_SECURITY',
      'EXPLAIN_NO_ERROR',
      'MANUAL_REVIEW',
    ].includes(String(recommendation.actionCode)) ||
    !['NEEDS_INFORMATION', 'PENDING_APPROVAL', 'MANDATORY_ESCALATION'].includes(
      String(recommendation.state),
    ) ||
    ![
      'L1_SUPERVISOR',
      'L2_COMPLIANCE',
      'SECURITY_TEAM',
      'CASE_SPECIALIST',
    ].includes(String(approval.level)) ||
    approval.required !== true ||
    response.generateAfterApproval !== true
  ) {
    throw new Error('处置输出违反固定枚举或审批后回复约束');
  }
  requireArray(recommendation.ruleIds, 'recommendation.ruleIds');
  requireArray(recommendation.evidenceIds, 'recommendation.evidenceIds');
  requireArray(output.prohibitedActions, 'prohibitedActions');
}
