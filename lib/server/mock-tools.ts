import type { CaseType, ToolName, ToolTrace } from '@/lib/domain';
import { mockDatabase } from '@/lib/server/mock-database';

type AgentRole = 'case_coordinator' | 'fact_rule_investigator';

type ToolResponse = {
  status: 'OK' | 'NOT_FOUND';
  data: unknown;
  error: null;
};

const allowedTools: Record<ToolName, AgentRole[]> = {
  get_customer_profile: ['case_coordinator', 'fact_rule_investigator'],
  get_loan_contract: ['fact_rule_investigator'],
  get_repayment_plan: ['fact_rule_investigator'],
  get_payment_transactions: ['fact_rule_investigator'],
  get_early_repayment_requests: ['fact_rule_investigator'],
  get_support_tickets: ['fact_rule_investigator'],
  get_account_security_events: ['fact_rule_investigator'],
  search_rules: ['fact_rule_investigator'],
};

export const toolLabels: Record<ToolName, string> = {
  get_customer_profile: '客户脱敏档案',
  get_loan_contract: '贷款合同与状态',
  get_repayment_plan: '还款计划',
  get_payment_transactions: '支付与扣款流水',
  get_early_repayment_requests: '提前还款申请',
  get_support_tickets: '历史客服工单',
  get_account_security_events: '账户安全事件',
  search_rules: '模拟规则库',
};

function asResponse(data: unknown): ToolResponse {
  const empty = data == null || (Array.isArray(data) && data.length === 0);
  return {
    status: empty ? 'NOT_FOUND' : 'OK',
    data: empty ? null : data,
    error: null,
  };
}

export function runReadOnlyTool(
  name: ToolName,
  args: Record<string, unknown>,
  actor: AgentRole,
): ToolResponse {
  if (!allowedTools[name]?.includes(actor)) {
    throw new Error(`DENY_AND_AUDIT: ${actor} cannot call ${name}`);
  }

  switch (name) {
    case 'get_customer_profile':
      return asResponse(
        mockDatabase.customers.find((item) => item.customerId === args.customerId),
      );
    case 'get_loan_contract':
      return asResponse(mockDatabase.loans.find((item) => item.loanId === args.loanId));
    case 'get_repayment_plan':
      return asResponse(mockDatabase.schedules.filter((item) => item.loanId === args.loanId));
    case 'get_payment_transactions':
      return asResponse(
        mockDatabase.transactions.filter(
          (item) =>
            item.customerId === args.customerId &&
            (args.loanId == null || item.loanId === args.loanId),
        ),
      );
    case 'get_early_repayment_requests':
      return asResponse(
        mockDatabase.earlyRepaymentRequests.filter((item) => item.loanId === args.loanId),
      );
    case 'get_support_tickets':
      return asResponse(
        mockDatabase.tickets.filter(
          (item) =>
            item.customerId === args.customerId &&
            (args.caseId == null || item.linkedCaseId === args.caseId),
        ),
      );
    case 'get_account_security_events':
      return asResponse(
        mockDatabase.securityEvents.filter((item) => item.customerId === args.customerId),
      );
    case 'search_rules':
      return asResponse(
        mockDatabase.rules.filter((item) =>
          item.businessTypes.includes(args.businessType as CaseType),
        ),
      );
  }
}

export function traceToolCall(
  name: ToolName,
  response: ToolResponse,
  index: number,
): ToolTrace {
  const recordCount = Array.isArray(response.data) ? response.data.length : response.data ? 1 : 0;
  return {
    name,
    label: toolLabels[name],
    status: response.status,
    recordCount,
    elapsedMs: 18 + index * 7,
  };
}
