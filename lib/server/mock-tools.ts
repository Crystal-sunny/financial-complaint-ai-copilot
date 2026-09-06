import type { CaseType, ToolName, ToolTrace } from '@/lib/domain';
import { mockDatabase } from '@/lib/server/mock-database';

type AgentRole = 'case_coordinator' | 'fact_rule_investigator';

export type ToolResponse = {
  status: 'OK' | 'NOT_FOUND' | 'ERROR';
  data: unknown;
  error: string | null;
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
  search_rules: '规则库',
};

function asResponse(data: unknown): ToolResponse {
  const empty = data == null || (Array.isArray(data) && data.length === 0);
  return {
    status: empty ? 'NOT_FOUND' : 'OK',
    data: empty ? null : data,
    error: null,
  };
}

// Date-only query boundaries use the project's business timezone (UTC+08:00).
// Validate the calendar date before Date.parse can normalize e.g. February 30.
function businessDayStart(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return null;
  const utc = Date.parse(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(utc) ||
    new Date(utc).toISOString().slice(0, 10) !== value
  )
    return null;
  return Date.parse(`${value}T00:00:00+08:00`);
}

function dateRange(args: Record<string, unknown>) {
  const from =
    args.dateFrom === undefined ? -Infinity : businessDayStart(args.dateFrom);
  const to =
    args.dateTo === undefined ? Infinity : businessDayStart(args.dateTo);
  if (from === null || to === null || from > to) return null;
  return { from, until: to + 86400000 };
}

function invalidDateResponse(): ToolResponse {
  return {
    status: 'ERROR',
    data: null,
    error: '查询日期无效，请提供有效日期范围。',
  };
}

export function runReadOnlyTool(
  name: ToolName,
  args: Record<string, unknown>,
  actor: AgentRole,
  database = mockDatabase,
): ToolResponse {
  if (!allowedTools[name]?.includes(actor)) {
    throw new Error(`DENY_AND_AUDIT: ${actor} cannot call ${name}`);
  }

  const range = dateRange(args);
  if (!range) return invalidDateResponse();
  const inRange = (timestamp: string) => {
    const time = Date.parse(timestamp);
    return Number.isFinite(time) && time >= range.from && time < range.until;
  };

  switch (name) {
    case 'get_customer_profile':
      return asResponse(
        database.customers.find((item) => item.customerId === args.customerId),
      );
    case 'get_loan_contract':
      return asResponse(
        database.loans.find((item) => item.loanId === args.loanId),
      );
    case 'get_repayment_plan':
      return asResponse(
        database.schedules.filter((item) => item.loanId === args.loanId),
      );
    case 'get_payment_transactions':
      return asResponse(
        database.transactions.filter(
          (item) =>
            item.customerId === args.customerId &&
            (args.loanId == null || item.loanId === args.loanId) &&
            inRange(item.initiatedAt),
        ),
      );
    case 'get_early_repayment_requests':
      return asResponse(
        database.earlyRepaymentRequests.filter(
          (item) => item.loanId === args.loanId,
        ),
      );
    case 'get_support_tickets':
      return asResponse(
        database.tickets.filter(
          (item) =>
            item.customerId === args.customerId &&
            (args.caseId == null || item.linkedCaseId === args.caseId),
        ),
      );
    case 'get_account_security_events':
      return asResponse(
        database.securityEvents.filter(
          (item) =>
            item.customerId === args.customerId && inRange(item.occurredAt),
        ),
      );
    case 'search_rules': {
      const effectiveAt = businessDayStart(args.effectiveAt);
      if (effectiveAt === null) return invalidDateResponse();
      return asResponse(
        database.rules.filter((item) => {
          const from = businessDayStart(item.effectiveFrom);
          const to =
            item.effectiveTo === null
              ? Infinity
              : businessDayStart(item.effectiveTo);
          return (
            item.businessTypes.includes(args.businessType as CaseType) &&
            from !== null &&
            to !== null &&
            from <= effectiveAt &&
            effectiveAt <= to
          );
        }),
      );
    }
  }
}

export function traceToolCall(
  name: ToolName,
  response: ToolResponse,
  index: number,
): ToolTrace {
  const recordCount = Array.isArray(response.data)
    ? response.data.length
    : response.data
      ? 1
      : 0;
  return {
    name,
    label: toolLabels[name],
    status: response.status,
    recordCount,
    elapsedMs: 18 + index * 7,
  };
}
