'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Copy,
  Database,
  FileCheck2,
  Gauge,
  Gavel,
  Landmark,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ScanSearch,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserRound,
  Workflow,
  XCircle,
} from 'lucide-react';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import type {
  AgentStageId,
  ApprovalOutcome,
  Evidence,
  InvestigationResult,
  ProviderMode,
  RuntimeCapabilities,
} from '@/lib/domain';

type DecisionState = 'idle' | 'pending' | 'approved' | 'returned' | 'replied';

type CaseView = {
  id: string;
  title: string;
  customer: string;
  customerMeta: string;
  loanId: string | null;
  age: string;
  priority: string;
  risk: 'MEDIUM' | 'HIGH';
  type: string;
  receivedAt: string;
  channel: string;
  statement: string;
  requests: string[];
};

const cases: CaseView[] = [
  {
    id: 'CMP-2026-09001',
    title: '提前还款后仍被扣款',
    customer: '林女士',
    customerMeta: '消费分期贷',
    loanId: 'LOAN-3001',
    age: '26 分钟',
    priority: '高优先级',
    risk: 'MEDIUM',
    type: '提前还款争议',
    receivedAt: '2026-08-15 10:26',
    channel: 'App 在线客服升级',
    statement:
      '我8月12日在App提前结清，页面显示申请成功，今天还是扣了1248.36元。客服又说系统没结清，我有截图。请退回多扣的钱并确认不会影响征信，否则我会投诉监管。',
    requests: ['退回 ¥1,248.36', '确认贷款结清状态', '确认是否存在逾期影响'],
  },
  {
    id: 'CMP-2026-09002',
    title: '疑似重复扣款',
    customer: '周先生',
    customerMeta: '消费分期贷',
    loanId: 'LOAN-3002',
    age: '1 小时 12 分',
    priority: '处理中',
    risk: 'MEDIUM',
    type: '重复扣款',
    receivedAt: '2026-08-20 11:18',
    channel: '客服热线',
    statement:
      '今天还款时第一次一直转圈，我就重新点了一次，结果银行卡短信显示扣了两笔588.20元。请马上把重复的一笔退给我。',
    requests: ['确认两笔交易状态', '退回多扣的 ¥588.20'],
  },
  {
    id: 'CMP-2026-09003',
    title: '非本人交易申诉',
    customer: '王先生',
    customerMeta: '钱包账户',
    loanId: null,
    age: '2 小时 08 分',
    priority: '风险核验',
    risk: 'HIGH',
    type: '疑似未授权交易',
    receivedAt: '2026-08-28 08:06',
    channel: 'App 安全入口',
    statement:
      '我昨晚一直在上海睡觉，凌晨有三笔我完全不认识的消费，共2578元。App还提示有新设备登录，这些都不是我操作的，请立刻处理。',
    requests: ['核查三笔非本人交易', '阻止损失继续扩大', '说明后续处理路径'],
  },
];

const runStages = [
  {
    stageId: 'case_coordinator' as const,
    label: '案件协调 Agent',
    detail: '识别诉求、业务类型与风险',
    waitingInput: '客户陈述与案件上下文',
    icon: Bot,
  },
  {
    stageId: 'fact_rule_investigator' as const,
    label: '事实与规则调查 Agent',
    detail: '调用服务端只读工具并建立证据链',
    waitingInput: '协调结果与只读工具计划',
    icon: ScanSearch,
  },
  {
    stageId: 'disposition_compliance' as const,
    label: '处置与合规审查 Agent',
    detail: '生成受证据门和审批约束的建议',
    waitingInput: '证据门、规则与冲突状态',
    icon: Gavel,
  },
];

const approvalLabels: Record<string, string> = {
  L1_SUPERVISOR: '一级组长审批',
  L2_COMPLIANCE: '二级合规审批',
  CASE_SPECIALIST: '案件专员复核',
  SECURITY_TEAM: '账户安全团队',
};

function BrandMark() {
  return (
    <div className="grid size-9 place-items-center rounded-[11px] bg-emerald-300 text-slate-950 shadow-[inset_0_0_0_1px_rgb(255_255_255/40%)]">
      <Landmark className="size-[18px]" strokeWidth={2.2} />
    </div>
  );
}

function EvidenceDot({ tone }: { tone: Evidence['tone'] }) {
  const className = {
    bad: 'bg-rose-500',
    warn: 'bg-amber-400',
    good: 'bg-emerald-500',
    neutral: 'bg-slate-400',
  }[tone];

  return (
    <span
      className={`relative z-10 mt-1 size-[11px] rounded-full border-2 border-white ring-1 ring-slate-200 ${className}`}
    />
  );
}

function formatEvidenceTime(value: string) {
  const match = value.match(/2026-(\d\d)-(\d\d)T(\d\d):(\d\d)/);
  return match ? `${match[1]}-${match[2]} ${match[3]}:${match[4]}` : value;
}

function formatDuration(value: number) {
  if (value < 1) return '<1 ms';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

export function CaseWorkbench() {
  const [providerMode, setProviderMode] = useState<ProviderMode>('recorded');
  const [runtime, setRuntime] = useState<RuntimeCapabilities>({
    defaultProvider: 'recorded',
    caseDataTransmission: 'paused',
    glm: { configured: false, available: false, model: 'glm-5.3-flash' },
    openai: { configured: false, available: false, model: 'gpt-5.4-mini' },
  });
  const [selectedId, setSelectedId] = useState(cases[0].id);
  const [resultsByCase, setResultsByCase] = useState<
    Record<string, InvestigationResult>
  >({});
  const [runStepsByCase, setRunStepsByCase] = useState<Record<string, number>>(
    {},
  );
  const [runningCaseId, setRunningCaseId] = useState<string | null>(null);
  const [decisionsByCase, setDecisionsByCase] = useState<
    Record<string, DecisionState>
  >({});
  const [approvalsByCase, setApprovalsByCase] = useState<
    Record<string, ApprovalOutcome>
  >({});
  const [approvalSubmittingCaseId, setApprovalSubmittingCaseId] = useState<
    string | null
  >(null);
  const [evidenceByCase, setEvidenceByCase] = useState<
    Record<string, string | null>
  >({});
  const [auditByCase, setAuditByCase] = useState<Record<string, boolean>>({});
  const [errorsByCase, setErrorsByCase] = useState<
    Record<string, string | null>
  >({});
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState<
    'all' | 'pending' | 'review' | 'completed' | 'high'
  >('all');
  const [todayOpen, setTodayOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [expandedAgentByCase, setExpandedAgentByCase] = useState<
    Record<string, AgentStageId | null>
  >({});

  const selectedCase = cases.find((item) => item.id === selectedId) ?? cases[0];
  const result = resultsByCase[selectedId] ?? null;
  const runStep = runStepsByCase[selectedId] ?? -1;
  const isRunning = runningCaseId === selectedId;
  const decision = decisionsByCase[selectedId] ?? 'idle';
  const approvalOutcome = approvalsByCase[selectedId] ?? null;
  const isApprovalSubmitting = approvalSubmittingCaseId === selectedId;
  const selectedEvidenceId = evidenceByCase[selectedId] ?? null;
  const showAudit = auditByCase[selectedId] ?? false;
  const error = errorsByCase[selectedId] ?? null;
  const filteredCases = (() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return cases.filter((item) => {
      const itemDecision = decisionsByCase[item.id] ?? 'idle';
      const hasResult = Boolean(resultsByCase[item.id]);
      const matchesQuery =
        !normalizedQuery ||
        `${item.id} ${item.title} ${item.customer}`
          .toLowerCase()
          .includes(normalizedQuery);
      const matchesFilter =
        queueFilter === 'all' ||
        (queueFilter === 'pending' && itemDecision !== 'replied') ||
        (queueFilter === 'review' && hasResult && itemDecision === 'pending') ||
        (queueFilter === 'completed' && itemDecision === 'replied') ||
        (queueFilter === 'high' && item.risk === 'HIGH');
      return matchesQuery && matchesFilter;
    });
  })();

  const historicalCompletedToday = 12;
  const repliedToday = Object.values(decisionsByCase).filter(
    (item) => item === 'replied',
  ).length;
  const totalToday = historicalCompletedToday + cases.length;
  const handledToday = historicalCompletedToday + repliedToday;
  const pendingToday = totalToday - handledToday;
  const expandedAgent = expandedAgentByCase[selectedId] ?? null;
  const totalAgentDuration =
    result?.agentRuns.reduce((total, agent) => total + agent.durationMs, 0) ??
    0;

  useEffect(() => {
    let active = true;
    fetch('/api/runtime')
      .then((response) => {
        if (!response.ok) throw new Error('runtime unavailable');
        return response.json() as Promise<RuntimeCapabilities>;
      })
      .then((capabilities) => {
        if (active) setRuntime(capabilities);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  function selectCase(caseId: string) {
    setSelectedId(caseId);
    setCopied(false);
    setTodayOpen(false);
  }

  async function runInvestigation() {
    if (runningCaseId) return;
    const caseId = selectedCase.id;
    setErrorsByCase((current) => ({ ...current, [caseId]: null }));
    setDecisionsByCase((current) => ({ ...current, [caseId]: 'idle' }));
    setApprovalsByCase((current) => {
      const next = { ...current };
      delete next[caseId];
      return next;
    });
    setAuditByCase((current) => ({ ...current, [caseId]: false }));
    setRunningCaseId(caseId);
    setRunStepsByCase((current) => ({ ...current, [caseId]: 0 }));
    setExpandedAgentByCase((current) => ({
      ...current,
      [caseId]: 'case_coordinator',
    }));

    try {
      const request = fetch(`/api/cases/${caseId}/investigate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerMode }),
      });
      await new Promise((resolve) => setTimeout(resolve, 420));
      setRunStepsByCase((current) => ({ ...current, [caseId]: 1 }));
      setExpandedAgentByCase((current) => ({
        ...current,
        [caseId]: 'fact_rule_investigator',
      }));
      await new Promise((resolve) => setTimeout(resolve, 580));
      setRunStepsByCase((current) => ({ ...current, [caseId]: 2 }));
      setExpandedAgentByCase((current) => ({
        ...current,
        [caseId]: 'disposition_compliance',
      }));
      const response = await request;
      if (!response.ok) throw new Error('调查服务暂时不可用');
      const data = (await response.json()) as InvestigationResult;
      await new Promise((resolve) => setTimeout(resolve, 520));
      setResultsByCase((current) => ({ ...current, [caseId]: data }));
      setDecisionsByCase((current) => ({ ...current, [caseId]: 'pending' }));
      setEvidenceByCase((current) => ({ ...current, [caseId]: null }));
      setRunStepsByCase((current) => ({ ...current, [caseId]: 3 }));
      setExpandedAgentByCase((current) => ({
        ...current,
        [caseId]: 'disposition_compliance',
      }));
    } catch (cause) {
      setErrorsByCase((current) => ({
        ...current,
        [caseId]: cause instanceof Error ? cause.message : '调查运行失败',
      }));
      setRunStepsByCase((current) => ({ ...current, [caseId]: -1 }));
    } finally {
      setRunningCaseId(null);
    }
  }

  function updateDecision(nextDecision: DecisionState) {
    setDecisionsByCase((current) => ({
      ...current,
      [selectedId]: nextDecision,
    }));
  }

  async function approveRecommendation() {
    if (!result || approvalSubmittingCaseId) return;
    const caseId = selectedId;
    setApprovalSubmittingCaseId(caseId);
    setErrorsByCase((current) => ({ ...current, [caseId]: null }));

    try {
      const response = await fetch(`/api/cases/${caseId}/approval`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('审批结果暂时无法返回');
      const outcome = (await response.json()) as ApprovalOutcome;
      setApprovalsByCase((current) => ({ ...current, [caseId]: outcome }));
      setDecisionsByCase((current) => ({
        ...current,
        [caseId]: 'approved',
      }));
    } catch (cause) {
      setErrorsByCase((current) => ({
        ...current,
        [caseId]: cause instanceof Error ? cause.message : '审批处理失败',
      }));
    } finally {
      setApprovalSubmittingCaseId(null);
    }
  }

  function updateEvidence(evidenceId: string | null) {
    setEvidenceByCase((current) => ({ ...current, [selectedId]: evidenceId }));
  }

  function toggleAudit() {
    setAuditByCase((current) => ({
      ...current,
      [selectedId]: !current[selectedId],
    }));
  }

  async function copyDraft() {
    if (!approvalOutcome) return;
    try {
      await navigator.clipboard.writeText(approvalOutcome.responseDraft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const recommendationBadge =
    decision === 'replied'
      ? '已回复'
      : decision === 'approved'
        ? '已批准'
        : decision === 'returned'
          ? '待补充'
          : decision === 'pending'
            ? '审批中'
            : result?.recommendation.state === 'MANDATORY_ESCALATION'
              ? '强制升级'
              : result?.recommendation.state === 'NEEDS_INFORMATION'
                ? '待复核'
                : '待审批';

  return (
    <main className="h-screen min-h-[720px] overflow-hidden bg-background">
      <header className="flex h-[68px] items-center justify-between border-b bg-white px-5 shadow-[0_1px_0_rgb(15_23_42/3%)]">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">
              金融客诉智能协同工作台
            </h1>
            <p className="mt-0.5 text-[11px] text-slate-500">
              证据驱动调查 · 人工审批闭环
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Popover open={todayOpen} onOpenChange={setTodayOpen}>
            <PopoverTrigger
              render={<Button variant="outline" className="h-9 px-3 text-xs" />}
            >
              <Clock3 data-icon="inline-start" className="text-amber-600" />
              今日待处理{' '}
              <span className="font-semibold text-slate-900">
                {pendingToday}
              </span>
              <ChevronDown data-icon="inline-end" />
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-72 p-3">
              <PopoverHeader className="border-b pb-2">
                <PopoverTitle className="text-xs">今日案件概览</PopoverTitle>
              </PopoverHeader>
              <div className="space-y-1">
                {cases.map((item) => {
                  const itemDecision = decisionsByCase[item.id] ?? 'idle';
                  const itemStatus =
                    itemDecision === 'replied'
                      ? '已回复'
                      : itemDecision === 'approved'
                        ? '已批准'
                        : itemDecision === 'pending'
                          ? '审批中'
                          : itemDecision === 'returned'
                            ? '待补充'
                            : resultsByCase[item.id]
                              ? '待人工处理'
                              : runningCaseId === item.id
                                ? '调查中'
                                : '待调查';
                  return (
                    <Button
                      key={item.id}
                      variant="ghost"
                      onClick={() => selectCase(item.id)}
                      className="h-auto w-full justify-between px-2 py-2 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-medium text-slate-800">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block font-mono text-[9px] text-slate-400">
                          {item.id}
                        </span>
                      </span>
                      <span
                        className={`ml-3 text-[10px] font-medium ${
                          itemStatus === '已回复'
                            ? 'text-emerald-700'
                            : itemStatus === '已批准'
                              ? 'text-teal-700'
                              : 'text-amber-700'
                        }`}
                      >
                        {itemStatus}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          <div className="flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs text-slate-700">
            <UserRound data-icon="inline-start" />
            审核员 · 王晨
          </div>
        </div>
      </header>

      <div className="grid h-[calc(100vh-68px)] min-h-[652px] grid-cols-[272px_minmax(590px,1fr)_350px]">
        <aside className="flex min-h-0 flex-col border-r bg-[oklch(0.985_0.004_100)]">
          <div className="border-b p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-900">案件队列</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  按风险与 SLA 排序
                </p>
              </div>
              <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      variant={queueFilter === 'all' ? 'outline' : 'secondary'}
                      size="icon-sm"
                      aria-label="筛选案件"
                    />
                  }
                >
                  <ListFilter />
                </PopoverTrigger>
                <PopoverContent align="end" sideOffset={6} className="w-44 p-2">
                  <PopoverHeader className="px-2 pb-1">
                    <PopoverTitle className="text-[11px]">
                      队列筛选
                    </PopoverTitle>
                  </PopoverHeader>
                  {[
                    ['all', '全部案件'],
                    ['pending', '待处理'],
                    ['review', '待人工审核'],
                    ['completed', '已完成'],
                    ['high', '高风险'],
                  ].map(([value, label]) => (
                    <Button
                      key={value}
                      variant={queueFilter === value ? 'secondary' : 'ghost'}
                      onClick={() => {
                        setQueueFilter(
                          value as
                            | 'all'
                            | 'pending'
                            | 'review'
                            | 'completed'
                            | 'high',
                        );
                        setFilterOpen(false);
                      }}
                      className="h-8 w-full justify-between px-2 text-[11px]"
                    >
                      {label}
                      {queueFilter === value && (
                        <Check data-icon="inline-end" />
                      )}
                    </Button>
                  ))}
                </PopoverContent>
              </Popover>
            </div>
            <div className="relative mt-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索案件号或客户"
                aria-label="搜索案件"
                className="h-9 bg-white pl-8 text-xs"
              />
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {filteredCases.map((item) => {
                const active = item.id === selectedId;
                const itemDecision = decisionsByCase[item.id] ?? 'idle';
                const itemStatus =
                  itemDecision === 'replied'
                    ? '已回复'
                    : itemDecision === 'approved'
                      ? '已批准'
                      : itemDecision === 'pending'
                        ? '审批中'
                        : itemDecision === 'returned'
                          ? '待补充'
                          : resultsByCase[item.id]
                            ? '待人工处理'
                            : runningCaseId === item.id
                              ? '调查中'
                              : item.priority;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectCase(item.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-teal-700/25 bg-white shadow-[0_5px_18px_rgb(15_118_110/8%)] ring-1 ring-teal-700/10'
                        : 'border-transparent bg-transparent hover:border-slate-200 hover:bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-medium text-slate-500">
                        {item.id}
                      </span>
                      {active && (
                        <CircleDot className="size-3.5 text-teal-600" />
                      )}
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-slate-900">
                      {item.title}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {item.customer} · {item.customerMeta}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span
                        className={`rounded-md px-1.5 py-1 text-[10px] font-medium ${
                          itemStatus === '已回复'
                            ? 'bg-emerald-50 text-emerald-700'
                            : itemStatus === '已批准'
                              ? 'bg-teal-50 text-teal-700'
                              : item.risk === 'HIGH'
                                ? 'bg-rose-50 text-rose-700'
                                : item.priority === '高优先级'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {itemStatus}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {item.age}
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredCases.length === 0 && (
                <div className="px-3 py-10 text-center">
                  <Search className="mx-auto size-4 text-slate-300" />
                  <p className="mt-2 text-[11px] text-slate-400">
                    没有符合条件的案件
                  </p>
                  <Button
                    variant="link"
                    size="xs"
                    onClick={() => {
                      setSearchQuery('');
                      setQueueFilter('all');
                    }}
                    className="mt-1 text-[10px]"
                  >
                    清除筛选
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="border-t p-4">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">今日处理进度</span>
              <span className="font-semibold text-slate-700">
                {handledToday} / {totalToday}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-teal-600 transition-[width] duration-300"
                style={{
                  width: `${Math.min((handledToday / totalToday) * 100, 100)}%`,
                }}
              />
            </div>
          </div>
        </aside>

        <section className="ledger-grid min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="@container mx-auto max-w-[920px] p-5 pb-12">
              <div className="rounded-xl border bg-white px-5 py-4 shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                <div className="flex items-start justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold tracking-wide text-teal-700">
                        {selectedCase.id}
                      </span>
                      <Badge
                        variant={
                          selectedCase.risk === 'HIGH'
                            ? 'destructive'
                            : 'secondary'
                        }
                        className={
                          selectedCase.risk === 'HIGH'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-700'
                        }
                      >
                        {selectedCase.risk === 'HIGH' ? '高风险' : '中风险'}
                      </Badge>
                      <Badge variant="outline" className="text-slate-600">
                        {decision === 'replied'
                          ? '已回复'
                          : decision === 'approved'
                            ? '已批准'
                            : decision === 'pending'
                              ? '审批中'
                              : decision === 'returned'
                                ? '待补充'
                                : result
                                  ? '待人工处理'
                                  : '待调查'}
                      </Badge>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                      {selectedCase.title}
                    </h2>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {selectedCase.type} · {selectedCase.channel} ·{' '}
                      {selectedCase.receivedAt}
                    </p>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-slate-50 px-4 py-3 text-[11px]">
                    <span className="text-slate-500">客户</span>
                    <span className="font-medium text-slate-800">
                      {selectedCase.customer}
                    </span>
                    <span className="text-slate-500">业务标识</span>
                    <span className="font-mono font-medium text-slate-800">
                      {selectedCase.loanId ?? 'WALLET-1003'}
                    </span>
                    <span className="text-slate-500">SLA 剩余</span>
                    <span className="font-medium text-amber-700">
                      {selectedCase.risk === 'HIGH' ? '01:51:42' : '03:34:12'}
                    </span>
                  </div>
                </div>
                <section
                  aria-label="调查判断"
                  className={`mt-4 rounded-lg border p-3.5 ${
                    result?.conflict.status === 'UNRESOLVED'
                      ? 'border-rose-200 bg-rose-50/70'
                      : result
                        ? 'border-amber-200 bg-amber-50/70'
                        : 'border-slate-200 bg-slate-50/80'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {result?.conflict.status === 'UNRESOLVED' ? (
                      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-700" />
                    ) : result ? (
                      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
                    ) : (
                      <ScanSearch className="mt-0.5 size-4 shrink-0 text-slate-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-xs font-semibold text-slate-900">
                          调查判断
                        </h3>
                        <Badge
                          variant="outline"
                          className={
                            result?.conflict.status === 'UNRESOLVED'
                              ? 'border-rose-200 text-rose-700'
                              : result
                                ? 'border-emerald-200 text-emerald-700'
                                : 'text-slate-500'
                          }
                        >
                          {result?.conflict.status === 'UNRESOLVED'
                            ? '需进一步核验'
                            : result
                              ? '已形成结论'
                              : '待核验'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-[11px] font-medium text-slate-700">
                        {result
                          ? result.conflict.title
                          : '当前尚无系统核验结论'}
                      </p>
                      <p className="mt-1.5 text-[11px] leading-[1.55] text-slate-600">
                        {result
                          ? result.conflict.resolution
                          : '客户陈述已记录，需结合账务、交易和规则记录完成核验。'}
                      </p>
                    </div>
                  </div>
                </section>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 @min-[760px]:grid-cols-[minmax(0,1fr)_459px]">
                <div className="min-w-0 space-y-4">
                  <div className="rounded-xl border bg-white shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <UserRound className="size-4 text-teal-700" />
                        <h3 className="text-sm font-semibold text-slate-900">
                          客户陈述
                        </h3>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        未经核验的原始主张
                      </span>
                    </div>
                    <div className="p-5">
                      <blockquote className="border-l-2 border-teal-600/50 pl-3 text-xs leading-[1.75] text-slate-600">
                        “{selectedCase.statement}”
                      </blockquote>
                      <div className="mt-4 flex flex-wrap gap-1.5">
                        {selectedCase.requests.map((request) => (
                          <span
                            key={request}
                            className="rounded-md border bg-slate-50 px-2 py-1 text-[10px] text-slate-600"
                          >
                            {request}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {result ? (
                    <div className="rounded-xl border bg-white shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <FileCheck2 className="size-4 text-teal-700" />
                          <h3 className="text-sm font-semibold text-slate-900">
                            事实时间线
                          </h3>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {result.evidence.length} 项关键证据 · 点击查看原文
                        </span>
                      </div>
                      <div className="p-5">
                        <div className="relative space-y-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-slate-200">
                          {result.evidence.map((event) => {
                            const active =
                              selectedEvidenceId === event.evidenceId;
                            return (
                              <div
                                key={event.evidenceId}
                                className={`relative rounded-lg transition-colors ${
                                  active
                                    ? 'bg-teal-50/70 ring-1 ring-teal-700/10'
                                    : 'hover:bg-slate-50'
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateEvidence(
                                      active ? null : event.evidenceId,
                                    )
                                  }
                                  aria-expanded={active}
                                  className="grid w-full grid-cols-[12px_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg py-1 pr-2 text-left"
                                >
                                  <EvidenceDot tone={event.tone} />
                                  <time className="pt-0.5 font-mono text-[10px] text-slate-400">
                                    {formatEvidenceTime(event.observedAt)}
                                  </time>
                                  <div className="col-start-2 min-w-0 break-words">
                                    <p className="text-xs font-semibold text-slate-800">
                                      {event.title}
                                    </p>
                                    <p className="mt-1 text-[11px] leading-[1.55] text-slate-500">
                                      {event.claim}
                                    </p>
                                    <span className="mt-1.5 inline-flex max-w-full flex-wrap items-center gap-1 break-all text-[10px] font-medium text-teal-700">
                                      {event.sourceRecordId} ·{' '}
                                      {active ? '收起原文' : '查看原文'}
                                      <ChevronDown
                                        className={`size-3 transition-transform ${
                                          active ? 'rotate-180' : ''
                                        }`}
                                      />
                                    </span>
                                  </div>
                                </button>
                                {active && (
                                  <div className="mb-3 ml-6 mr-3 mt-2 min-w-0 rounded-lg border border-teal-700/15 bg-white/80 p-3">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="text-[10px] font-semibold text-teal-800">
                                        证据原文
                                      </span>
                                      <span className="max-w-full break-all font-mono text-[9px] text-teal-700/70">
                                        {event.sourceSystem} ·{' '}
                                        {event.sourceRecordId}
                                      </span>
                                    </div>
                                    <p className="mt-2 break-words font-mono text-[10px] leading-5 text-slate-600">
                                      {event.rawExcerpt}
                                    </p>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-white/60 px-6 py-10 text-center">
                      <Database className="mx-auto size-5 text-slate-400" />
                      <p className="mt-3 text-xs font-medium text-slate-600">
                        事实证据尚未加载
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        启动调查后，服务端工具会返回脱敏记录与稳定证据 ID。
                      </p>
                    </div>
                  )}

                  {result && (
                    <div className="rounded-xl border bg-white">
                      <button
                        type="button"
                        onClick={toggleAudit}
                        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                          <LockKeyhole className="size-3.5 text-teal-700" />
                          审计记录与工具轨迹
                        </span>
                        <span className="text-[10px] font-medium text-teal-700">
                          {showAudit
                            ? '收起'
                            : `查看 ${result.toolTraces.length} 次调用`}
                        </span>
                      </button>
                      {showAudit && (
                        <div className="border-t p-4">
                          <div className="grid grid-cols-2 gap-2">
                            {result.toolTraces.map((trace) => (
                              <div
                                key={trace.name}
                                className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-[10px] font-medium text-slate-700">
                                    {trace.label}
                                  </p>
                                  <p className="mt-0.5 font-mono text-[8px] text-slate-400">
                                    {trace.name}
                                  </p>
                                </div>
                                <span
                                  className={`ml-2 text-[9px] font-semibold ${
                                    trace.status === 'OK'
                                      ? 'text-emerald-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {trace.status} · {trace.recordCount}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 space-y-2 border-l border-slate-200 pl-3">
                            {result.auditEvents.map((event) => (
                              <div
                                key={`${event.at}-${event.actor}`}
                                className="flex gap-3 text-[10px]"
                              >
                                <time className="font-mono text-slate-400">
                                  {event.at}
                                </time>
                                <span className="font-medium text-slate-700">
                                  {event.actor}
                                </span>
                                <span className="text-slate-500">
                                  {event.action}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="overflow-hidden rounded-xl border bg-white shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                    <div className="border-b border-teal-900/10 bg-gradient-to-br from-teal-950 to-teal-800 p-4 text-white">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="grid size-7 place-items-center rounded-lg bg-white/10 ring-1 ring-white/15">
                            <Workflow className="size-4 text-emerald-300" />
                          </div>
                          <h3 className="text-sm font-semibold">
                            AI Agent 协同调查
                          </h3>
                        </div>
                        <span className="rounded-full bg-emerald-300/15 px-2 py-1 font-mono text-[9px] font-semibold text-emerald-200 ring-1 ring-emerald-300/20">
                          3 AGENTS
                        </span>
                      </div>
                      <p className="mt-2 text-[10px] leading-4 text-teal-100/75">
                        三个 Agent
                        串行协作，每一步的输入、输出与运行指标都可追溯。
                      </p>
                    </div>

                    <div className="p-4">
                      <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
                        <Button
                          type="button"
                          size="xs"
                          variant={
                            providerMode === 'recorded' ? 'secondary' : 'ghost'
                          }
                          onClick={() => setProviderMode('recorded')}
                          disabled={Boolean(runningCaseId)}
                          className="h-7 text-[10px]"
                        >
                          稳定模式
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant={
                            providerMode === 'glm' ? 'secondary' : 'ghost'
                          }
                          disabled
                          aria-describedby="model-availability"
                          title={
                            runtime.glm.configured
                              ? '密钥已配置，案件数据外发已暂停'
                              : '待配置智谱密钥；案件数据外发已暂停'
                          }
                          className="h-7 text-[10px]"
                        >
                          智谱 GLM · 已暂停
                        </Button>
                      </div>
                      <p
                        id="model-availability"
                        aria-live="polite"
                        className="mt-1.5 break-words text-[9px] leading-4 text-slate-500"
                      >
                        {runtime.glm.configured
                          ? `${runtime.glm.model} 密钥已配置；案件外发已暂停，当前使用稳定模式，不消耗模型额度。`
                          : '智谱密钥待配置；案件外发已暂停，稳定模式正常可用。'}
                      </p>

                      {result ? (
                        <div className="mt-3 rounded-lg border border-teal-800/10 bg-teal-50/55 p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="inline-flex min-w-0 items-center gap-1.5 break-all text-[10px] font-semibold text-teal-900">
                              <Activity className="size-3.5 shrink-0 text-teal-700" />
                              {result.execution.actualProvider === 'openai'
                                ? result.execution.model
                                : '稳定执行流'}
                            </span>
                            <span className="max-w-full break-all font-mono text-[8px] text-teal-700/70">
                              {result.runId}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-1.5">
                            {[
                              ['总耗时', formatDuration(totalAgentDuration)],
                              ['工具调用', `${result.toolTraces.length} 次`],
                              ['关键证据', `${result.evidence.length} 项`],
                            ].map(([label, value]) => (
                              <div
                                key={label}
                                className="rounded-md bg-white/80 px-1.5 py-1.5 text-center ring-1 ring-teal-900/5"
                              >
                                <p className="text-[8px] text-slate-400">
                                  {label}
                                </p>
                                <p className="mt-0.5 font-mono text-[9px] font-semibold text-slate-700">
                                  {value}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed bg-slate-50 px-2.5 py-2 text-[9px] text-slate-500">
                          <Gauge className="size-3.5 text-teal-700" />
                          运行后将生成完整的 Agent 执行档案
                        </div>
                      )}

                      <Accordion
                        value={expandedAgent ? [expandedAgent] : []}
                        onValueChange={(values) =>
                          setExpandedAgentByCase((current) => ({
                            ...current,
                            [selectedId]:
                              (values[0] as AgentStageId | undefined) ?? null,
                          }))
                        }
                        className="mt-3 gap-2"
                      >
                        {runStages.map((stage, index) => {
                          const StageIcon = stage.icon;
                          const trace = result?.agentRuns.find(
                            (agent) => agent.stageId === stage.stageId,
                          );
                          const completed = Boolean(trace) || runStep > index;
                          const active = isRunning && runStep === index;
                          const statusLabel = active
                            ? '运行中'
                            : completed
                              ? '已完成'
                              : '待运行';
                          return (
                            <AccordionItem
                              key={stage.stageId}
                              value={stage.stageId}
                              className={`overflow-hidden rounded-lg border ${
                                active
                                  ? 'border-teal-500/30 bg-teal-50/70'
                                  : completed
                                    ? 'border-emerald-600/15 bg-emerald-50/45'
                                    : 'border-slate-200 bg-slate-50/70'
                              }`}
                            >
                              <AccordionTrigger className="items-center px-2.5 py-2 hover:no-underline">
                                <span className="flex min-w-0 flex-1 items-center gap-2">
                                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white shadow-sm ring-1 ring-slate-900/5">
                                    {active ? (
                                      <LoaderCircle className="size-3.5 animate-spin text-teal-700" />
                                    ) : completed ? (
                                      <Check className="size-3.5 text-emerald-700" />
                                    ) : (
                                      <StageIcon className="size-3.5 text-slate-400" />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block break-words text-[10px] font-semibold leading-4 text-slate-800">
                                      {stage.label}
                                    </span>
                                    <span className="mt-0.5 block break-words text-[8px] font-normal leading-3.5 text-slate-400">
                                      {stage.detail}
                                    </span>
                                  </span>
                                  <span className="mr-1 shrink-0 text-right">
                                    <span
                                      className={`block text-[8px] font-semibold ${
                                        active
                                          ? 'text-teal-700'
                                          : completed
                                            ? 'text-emerald-700'
                                            : 'text-slate-400'
                                      }`}
                                    >
                                      {statusLabel}
                                    </span>
                                    <span className="mt-0.5 block font-mono text-[8px] font-normal text-slate-400">
                                      {trace
                                        ? formatDuration(trace.durationMs)
                                        : '—'}
                                    </span>
                                  </span>
                                </span>
                              </AccordionTrigger>
                              <AccordionContent className="border-t border-slate-200/70 px-2.5 pb-2.5 pt-2">
                                <div className="space-y-2.5">
                                  {[
                                    {
                                      label: '输入',
                                      values: trace?.inputSummary ?? [
                                        stage.waitingInput,
                                      ],
                                      tone: 'text-sky-700',
                                    },
                                    {
                                      label: '处理',
                                      values: trace?.actions ?? [stage.detail],
                                      tone: 'text-violet-700',
                                    },
                                    {
                                      label: '输出',
                                      values: trace?.outputSummary ?? [
                                        active
                                          ? '正在生成结构化输出…'
                                          : '运行完成后生成',
                                      ],
                                      tone: 'text-emerald-700',
                                    },
                                  ].map((section) => (
                                    <div key={section.label}>
                                      <p
                                        className={`text-[8px] font-bold tracking-[0.12em] ${section.tone}`}
                                      >
                                        {section.label}
                                      </p>
                                      <ul className="mt-1 space-y-1">
                                        {section.values.map((value) => (
                                          <li
                                            key={value}
                                            className="flex gap-1.5 text-[9px] leading-4 text-slate-600"
                                          >
                                            <span className="mt-[6px] size-1 shrink-0 rounded-full bg-slate-300" />
                                            <span className="min-w-0 break-words">
                                              {value}
                                            </span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}

                                  {trace && (
                                    <>
                                      <div className="grid grid-cols-2 gap-1.5 border-t border-slate-200 pt-2.5">
                                        {[
                                          ['工具', trace.metrics.toolCalls],
                                          ['记录', trace.metrics.recordCount],
                                          ['证据', trace.metrics.evidenceCount],
                                          ['规则', trace.metrics.ruleCount],
                                        ].map(([label, value]) => (
                                          <div
                                            key={label}
                                            className="flex items-center justify-between rounded-md bg-white px-2 py-1.5 ring-1 ring-slate-900/5"
                                          >
                                            <span className="text-[8px] text-slate-400">
                                              {label}
                                            </span>
                                            <span className="font-mono text-[9px] font-semibold text-slate-700">
                                              {value}
                                            </span>
                                          </div>
                                        ))}
                                      </div>

                                      <Collapsible
                                        key={`${result?.runId}-${stage.stageId}`}
                                      >
                                        <CollapsibleTrigger className="group/technical flex w-full items-center justify-between rounded-md border bg-white px-2 py-1.5 text-left text-[9px] font-semibold text-slate-600 outline-none transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-teal-600/30">
                                          <span className="flex items-center gap-1.5">
                                            <Braces className="size-3 text-teal-700" />
                                            技术详情
                                          </span>
                                          <ChevronDown className="size-3 text-slate-400 transition-transform group-aria-expanded/technical:rotate-180" />
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                          <div className="mt-1.5 min-w-0 rounded-md bg-slate-950 p-2 text-slate-200">
                                            <div className="flex flex-wrap items-center justify-between gap-1 text-[8px] text-slate-400">
                                              <span>
                                                {trace.provider === 'openai'
                                                  ? '模型执行'
                                                  : '稳定执行'}
                                              </span>
                                              {trace.technicalDetails
                                                .responseId && (
                                                <span className="max-w-full break-all font-mono">
                                                  {
                                                    trace.technicalDetails
                                                      .responseId
                                                  }
                                                </span>
                                              )}
                                            </div>
                                            {trace.metrics.inputTokens !==
                                              null && (
                                              <p className="mt-1 font-mono text-[8px] text-teal-300">
                                                tokens in{' '}
                                                {trace.metrics.inputTokens} ·
                                                out {trace.metrics.outputTokens}
                                              </p>
                                            )}
                                            <p className="mt-2 text-[8px] font-semibold text-sky-300">
                                              INPUT
                                            </p>
                                            <pre className="mt-1 max-h-40 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[8px] leading-4">
                                              {JSON.stringify(
                                                trace.technicalDetails.input,
                                                null,
                                                2,
                                              )}
                                            </pre>
                                            <p className="mt-2 border-t border-white/10 pt-2 text-[8px] font-semibold text-emerald-300">
                                              OUTPUT
                                            </p>
                                            <pre className="mt-1 max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all font-mono text-[8px] leading-4">
                                              {JSON.stringify(
                                                trace.technicalDetails.output,
                                                null,
                                                2,
                                              )}
                                            </pre>
                                          </div>
                                        </CollapsibleContent>
                                      </Collapsible>
                                    </>
                                  )}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          );
                        })}
                      </Accordion>

                      {result && (
                        <div
                          className={`mt-3 rounded-lg border p-2.5 ${
                            result.execution.fallbackUsed
                              ? 'border-amber-200 bg-amber-50'
                              : 'border-emerald-200 bg-emerald-50/70'
                          }`}
                        >
                          <p className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-700">
                            <ShieldCheck
                              className={`size-3.5 ${
                                result.execution.fallbackUsed
                                  ? 'text-amber-700'
                                  : 'text-emerald-700'
                              }`}
                            />
                            {result.execution.actualProvider === 'openai'
                              ? '模型结果已通过安全校验'
                              : '稳定结果已通过安全校验'}
                          </p>
                          <p className="mt-1 text-[9px] leading-4 text-slate-500">
                            {result.execution.validationChecks.length}{' '}
                            项硬性检查通过
                          </p>
                          {result.execution.fallbackReason && (
                            <p className="mt-1 text-[9px] leading-4 text-amber-700">
                              {result.execution.fallbackReason}
                            </p>
                          )}
                        </div>
                      )}

                      {error && (
                        <div className="mt-3 rounded-lg bg-rose-50 p-2.5 text-[10px] text-rose-700">
                          {error}
                        </div>
                      )}

                      <Button
                        onClick={runInvestigation}
                        disabled={Boolean(runningCaseId)}
                        className="mt-4 h-9 w-full justify-between px-3 text-xs"
                      >
                        {isRunning
                          ? 'Agent 协作进行中…'
                          : runningCaseId
                            ? '另一案件调查中…'
                            : result
                              ? '重新运行 Agent 调查'
                              : providerMode === 'openai'
                                ? '开始模型 Agent 调查'
                                : '开始 AI Agent 调查'}
                        {isRunning ? (
                          <LoaderCircle
                            data-icon="inline-end"
                            className="animate-spin"
                          />
                        ) : result ? (
                          <RotateCcw data-icon="inline-end" />
                        ) : (
                          <ArrowRight data-icon="inline-end" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl border bg-white p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <ShieldCheck className="size-4 text-emerald-600" />
                      合规护栏
                    </div>
                    <ul className="mt-3 space-y-2 text-[10px] leading-4 text-slate-500">
                      <li className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                        仅读取业务数据，不执行资金操作
                      </li>
                      <li className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                        结论必须关联稳定证据 ID
                      </li>
                      <li className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                        对外回复必须经过人工确认
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </ScrollArea>
        </section>

        <aside className="flex min-h-0 flex-col border-l bg-white">
          <div className="border-b px-5 py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">处置建议</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {result ? `运行 ${result.runId}` : '等待调查结果生成'}
                </p>
              </div>
              <Badge
                variant={
                  result?.recommendation.state === 'MANDATORY_ESCALATION'
                    ? 'destructive'
                    : 'outline'
                }
                className={
                  decision === 'replied'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : decision === 'approved'
                      ? 'border-teal-200 bg-teal-50 text-teal-700'
                      : decision === 'pending'
                        ? 'border-amber-200 bg-amber-50 text-amber-700'
                        : result
                          ? 'text-slate-700'
                          : 'text-slate-500'
                }
              >
                {result ? recommendationBadge : '未生成'}
              </Badge>
            </div>
          </div>

          {result ? (
            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 p-5">
                <div
                  className={`rounded-xl border p-4 ${
                    result.recommendation.state === 'MANDATORY_ESCALATION'
                      ? 'border-rose-200 bg-rose-50/60'
                      : 'border-teal-700/15 bg-teal-50/50'
                  }`}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    建议动作
                  </p>
                  <p className="mt-2 text-[15px] font-semibold leading-6 text-slate-950">
                    {result.recommendation.action}
                  </p>
                  {result.recommendation.amount != null && (
                    <p className="mt-2 font-mono text-xs text-slate-500">
                      涉及金额 ¥
                      {result.recommendation.amount.toLocaleString('zh-CN', {
                        minimumFractionDigits: 2,
                      })}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-slate-500">
                    判断依据
                  </p>
                  <p className="mt-2 text-[11px] leading-[1.7] text-slate-600">
                    {result.recommendation.rationale}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-slate-500">
                    已确认事实
                  </p>
                  <ul className="mt-2 space-y-2">
                    {result.confirmedFacts.map((fact) => (
                      <li
                        key={fact}
                        className="flex gap-2 text-[11px] leading-[1.55] text-slate-600"
                      >
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-xl border bg-slate-50 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-800">
                      <Gavel className="size-3.5 text-teal-700" />
                      审批流程
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        decision === 'approved' || decision === 'replied'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : decision === 'returned'
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-teal-200 bg-teal-50 text-teal-700'
                      }
                    >
                      {decision === 'approved' || decision === 'replied'
                        ? '已通过'
                        : decision === 'returned'
                          ? '已退回'
                          : '审批中'}
                    </Badge>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="flex gap-2.5">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                        <Check className="size-3" />
                      </span>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-700">
                          处置建议已自动提交
                        </p>
                        <p className="mt-0.5 text-[9px] leading-4 text-slate-500">
                          {approvalLabels[result.approval.level]} ·{' '}
                          {result.approval.reason}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2.5">
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full ${
                          decision === 'approved' || decision === 'replied'
                            ? 'bg-emerald-100 text-emerald-700'
                            : decision === 'returned'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-teal-100 text-teal-700'
                        }`}
                      >
                        {isApprovalSubmitting ? (
                          <LoaderCircle className="size-3 animate-spin" />
                        ) : decision === 'approved' ||
                          decision === 'replied' ? (
                          <Check className="size-3" />
                        ) : decision === 'returned' ? (
                          <RotateCcw className="size-3" />
                        ) : (
                          <Clock3 className="size-3" />
                        )}
                      </span>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-700">
                          {isApprovalSubmitting
                            ? '正在获取审批结果'
                            : decision === 'approved' || decision === 'replied'
                              ? '审批已通过'
                              : decision === 'returned'
                                ? '已退回补充'
                                : '等待审批人处理'}
                        </p>
                        <p className="mt-0.5 text-[9px] leading-4 text-slate-500">
                          {approvalOutcome
                            ? `${approvalOutcome.completedAt} · ${approvalOutcome.approvalId}`
                            : decision === 'returned'
                              ? '需补充证据后重新提交'
                              : '审批完成前不生成对客回复'}
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2.5">
                      <span
                        className={`grid size-5 shrink-0 place-items-center rounded-full ${
                          approvalOutcome
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {approvalOutcome ? (
                          <Check className="size-3" />
                        ) : (
                          <Clock3 className="size-3" />
                        )}
                      </span>
                      <div>
                        <p className="text-[10px] font-semibold text-slate-700">
                          {approvalOutcome
                            ? '处理结论与时限已确认'
                            : '等待明确处理结论与时间'}
                        </p>
                        {approvalOutcome && (
                          <div className="mt-1 space-y-1 text-[9px] leading-4 text-slate-500">
                            <p>{approvalOutcome.decision}</p>
                            <p>{approvalOutcome.executionStatus}</p>
                            <p>
                              最晚完成时间：{approvalOutcome.executionDeadline}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1">
                    {result.recommendation.ruleIds.map((ruleId) => (
                      <span
                        key={ruleId}
                        className="rounded bg-white px-1.5 py-1 font-mono text-[8px] text-teal-700 ring-1 ring-slate-200"
                      >
                        {ruleId}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold text-rose-700">
                    <XCircle className="size-3" /> 禁止动作
                  </p>
                  <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-slate-500">
                    {result.prohibitedActions.map((item) => (
                      <li key={item}>· {item}</li>
                    ))}
                  </ul>
                </div>

                {approvalOutcome &&
                  (decision === 'approved' || decision === 'replied') && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                      <div className="flex items-center justify-between">
                        <p className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                          <ClipboardCheck className="size-4" />
                          客户回复草稿
                        </p>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={copyDraft}
                          className="text-emerald-800"
                        >
                          {copied ? (
                            <Check data-icon="inline-start" />
                          ) : (
                            <Copy data-icon="inline-start" />
                          )}
                          {copied ? '已复制' : '复制'}
                        </Button>
                      </div>
                      <p className="mt-2 text-[9px] text-emerald-700">
                        根据已通过的处理结论生成
                      </p>
                      <p className="mt-3 text-[11px] leading-[1.7] text-slate-600">
                        {approvalOutcome.responseDraft}
                      </p>
                    </div>
                  )}

                {decision === 'returned' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">
                    已退回事实调查环节；系统不会自动修改原始证据或执行外部操作。
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <FileCheck2 className="size-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700">
                尚无处置建议
              </p>
              <p className="mt-2 max-w-[230px] text-[11px] leading-[1.65] text-slate-400">
                完成证据调查后，这里将展示责任判断、处理建议与审批流程；客户回复草稿仅在审批结论确认后生成。
              </p>
            </div>
          )}

          <div className="border-t bg-slate-50 p-4">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">审批操作</span>
              <span
                className={
                  decision === 'replied'
                    ? 'font-medium text-emerald-700'
                    : decision === 'approved'
                      ? 'font-medium text-teal-700'
                      : decision === 'pending'
                        ? 'font-medium text-amber-700'
                        : 'text-slate-400'
                }
              >
                {decision === 'replied'
                  ? '已完成回复'
                  : decision === 'approved'
                    ? '结论已确认'
                    : decision === 'pending'
                      ? '已自动提交'
                      : decision === 'returned'
                        ? '已退回补充'
                        : '未提交'}
              </span>
            </div>

            {decision === 'approved' && approvalOutcome ? (
              <Button
                onClick={() => updateDecision('replied')}
                className="mt-3 h-9 w-full text-xs"
              >
                <Send data-icon="inline-start" />
                标记已回复客户
              </Button>
            ) : decision === 'replied' ? (
              <div className="mt-3 flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-100 text-xs font-medium text-emerald-800">
                <CheckCircle2 className="size-4" /> 案件闭环完成
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  disabled={
                    !result ||
                    isRunning ||
                    isApprovalSubmitting ||
                    decision === 'returned'
                  }
                  variant="outline"
                  onClick={() => updateDecision('returned')}
                  className="h-9 text-xs"
                >
                  退回补充
                </Button>
                <Button
                  disabled={
                    !result ||
                    isRunning ||
                    isApprovalSubmitting ||
                    decision === 'returned'
                  }
                  onClick={approveRecommendation}
                  className="h-9 text-xs"
                >
                  {isApprovalSubmitting ? (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : null}
                  {isApprovalSubmitting
                    ? '审批处理中…'
                    : result?.recommendation.state === 'MANDATORY_ESCALATION'
                      ? '确认转办'
                      : '审批通过'}
                </Button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
