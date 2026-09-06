'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Clock3,
  Copy,
  Database,
  FileCheck2,
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
  XCircle,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Evidence, InvestigationResult } from '@/lib/domain';

type DecisionState = 'idle' | 'approved' | 'returned' | 'replied';

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
  { label: '案件协调', detail: '识别诉求、业务类型与风险', icon: Bot },
  { label: '事实与规则调查', detail: '调用八个服务端只读工具', icon: ScanSearch },
  { label: '处置与合规审查', detail: '生成有证据约束的建议', icon: Gavel },
];

const approvalLabels: Record<string, string> = {
  L1_SUPERVISOR: '一级组长审批',
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

export function CaseWorkbench() {
  const [selectedId, setSelectedId] = useState(cases[0].id);
  const [result, setResult] = useState<InvestigationResult | null>(null);
  const [runStep, setRunStep] = useState(-1);
  const [isRunning, setIsRunning] = useState(false);
  const [decision, setDecision] = useState<DecisionState>('idle');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCase = cases.find((item) => item.id === selectedId) ?? cases[0];
  const selectedEvidence = useMemo(
    () => result?.evidence.find((item) => item.evidenceId === selectedEvidenceId) ?? null,
    [result, selectedEvidenceId],
  );

  function selectCase(caseId: string) {
    setSelectedId(caseId);
    setResult(null);
    setRunStep(-1);
    setDecision('idle');
    setSelectedEvidenceId(null);
    setShowAudit(false);
    setCopied(false);
    setError(null);
  }

  async function runInvestigation() {
    setError(null);
    setResult(null);
    setDecision('idle');
    setSelectedEvidenceId(null);
    setShowAudit(false);
    setIsRunning(true);
    setRunStep(0);

    try {
      const request = fetch(`/api/cases/${selectedCase.id}/investigate`, {
        method: 'POST',
      });
      await new Promise((resolve) => setTimeout(resolve, 420));
      setRunStep(1);
      await new Promise((resolve) => setTimeout(resolve, 580));
      setRunStep(2);
      const response = await request;
      if (!response.ok) throw new Error('调查服务暂时不可用');
      const data = (await response.json()) as InvestigationResult;
      await new Promise((resolve) => setTimeout(resolve, 520));
      setResult(data);
      setSelectedEvidenceId(data.evidence[0]?.evidenceId ?? null);
      setRunStep(3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '调查运行失败');
      setRunStep(-1);
    } finally {
      setIsRunning(false);
    }
  }

  async function copyDraft() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.responseDraft);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const recommendationBadge =
    result?.recommendation.state === 'MANDATORY_ESCALATION'
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
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-semibold tracking-tight text-slate-900">
                金融客诉智能协同工作台
              </h1>
              <Badge
                variant="secondary"
                className="bg-teal-50 text-[10px] text-teal-800 ring-1 ring-teal-700/10"
              >
                DEMO · 模拟数据
              </Badge>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">证据驱动调查 · 人工审批闭环</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <Clock3 className="size-3.5 text-amber-600" />
            今日待处理 <span className="font-semibold text-slate-900">8</span>
          </div>
          <Button variant="outline" className="h-9 px-3 text-xs">
            <UserRound data-icon="inline-start" />
            审核员 · 王晨
            <ChevronDown data-icon="inline-end" />
          </Button>
        </div>
      </header>

      <div className="grid h-[calc(100vh-68px)] min-h-[652px] grid-cols-[272px_minmax(590px,1fr)_350px]">
        <aside className="flex min-h-0 flex-col border-r bg-[oklch(0.985_0.004_100)]">
          <div className="border-b p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-900">案件队列</p>
                <p className="mt-0.5 text-[11px] text-slate-500">按风险与 SLA 排序</p>
              </div>
              <Button variant="outline" size="icon-sm" aria-label="筛选案件">
                <ListFilter />
              </Button>
            </div>
            <div className="mt-3 flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs text-slate-400">
              <Search className="size-3.5" />
              搜索案件号或客户
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-2 p-3">
              {cases.map((item) => {
                const active = item.id === selectedId;
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
                      <span className="font-mono text-[10px] font-medium text-slate-500">{item.id}</span>
                      {active && <CircleDot className="size-3.5 text-teal-600" />}
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {item.customer} · {item.customerMeta}
                    </p>
                    <div className="mt-3 flex items-center justify-between">
                      <span
                        className={`rounded-md px-1.5 py-1 text-[10px] font-medium ${
                          item.risk === 'HIGH'
                            ? 'bg-rose-50 text-rose-700'
                            : item.priority === '高优先级'
                              ? 'bg-amber-50 text-amber-700'
                              : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {item.priority}
                      </span>
                      <span className="text-[10px] text-slate-400">{item.age}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          <div className="border-t p-4">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">今日处理进度</span>
              <span className="font-semibold text-slate-700">12 / 20</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full w-3/5 rounded-full bg-teal-600" />
            </div>
          </div>
        </aside>

        <section className="ledger-grid min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="mx-auto max-w-[920px] p-5 pb-12">
              <div className="rounded-xl border bg-white px-5 py-4 shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                <div className="flex items-start justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] font-semibold tracking-wide text-teal-700">
                        {selectedCase.id}
                      </span>
                      <Badge
                        variant={selectedCase.risk === 'HIGH' ? 'destructive' : 'secondary'}
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
                            : result
                              ? '待人工处理'
                              : '待调查'}
                      </Badge>
                    </div>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
                      {selectedCase.title}
                    </h2>
                    <p className="mt-1.5 text-xs text-slate-500">
                      {selectedCase.type} · {selectedCase.channel} · {selectedCase.receivedAt}
                    </p>
                  </div>
                  <div className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border bg-slate-50 px-4 py-3 text-[11px]">
                    <span className="text-slate-500">客户</span>
                    <span className="font-medium text-slate-800">{selectedCase.customer}</span>
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
              </div>

              <div className="mt-4 grid grid-cols-[minmax(0,1fr)_270px] gap-4">
                <div className="space-y-4">
                  <div className="rounded-xl border bg-white shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                    <div className="flex items-center justify-between border-b px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <UserRound className="size-4 text-teal-700" />
                        <h3 className="text-sm font-semibold text-slate-900">客户陈述</h3>
                      </div>
                      <span className="text-[10px] text-slate-400">未经核验的原始主张</span>
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
                      <div className="flex items-center justify-between border-b px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <FileCheck2 className="size-4 text-teal-700" />
                          <h3 className="text-sm font-semibold text-slate-900">事实时间线</h3>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {result.evidence.length} 项关键证据 · 点击查看原文
                        </span>
                      </div>
                      <div className="p-5">
                        <div className="relative space-y-5 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-slate-200">
                          {result.evidence.map((event) => {
                            const active = selectedEvidenceId === event.evidenceId;
                            return (
                              <button
                                key={event.evidenceId}
                                type="button"
                                onClick={() => setSelectedEvidenceId(event.evidenceId)}
                                className={`relative grid w-full grid-cols-[12px_82px_1fr] gap-3 rounded-lg text-left transition-colors ${
                                  active ? 'bg-teal-50/70 py-2 pr-2 ring-1 ring-teal-700/10' : 'hover:bg-slate-50'
                                }`}
                              >
                                <EvidenceDot tone={event.tone} />
                                <time className="pt-0.5 font-mono text-[10px] text-slate-400">
                                  {formatEvidenceTime(event.observedAt)}
                                </time>
                                <div>
                                  <p className="text-xs font-semibold text-slate-800">{event.title}</p>
                                  <p className="mt-1 text-[11px] leading-[1.55] text-slate-500">{event.claim}</p>
                                  <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-medium text-teal-700">
                                    {event.sourceRecordId} <ArrowRight className="size-3" />
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {selectedEvidence && (
                          <div className="mt-5 rounded-lg border border-teal-700/15 bg-teal-50/50 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-[10px] font-semibold text-teal-800">证据原文</span>
                              <span className="font-mono text-[9px] text-teal-700/70">
                                {selectedEvidence.sourceSystem} · {selectedEvidence.sourceRecordId}
                              </span>
                            </div>
                            <p className="mt-2 font-mono text-[10px] leading-5 text-slate-600">
                              {selectedEvidence.rawExcerpt}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed bg-white/60 px-6 py-10 text-center">
                      <Database className="mx-auto size-5 text-slate-400" />
                      <p className="mt-3 text-xs font-medium text-slate-600">事实证据尚未加载</p>
                      <p className="mt-1 text-[10px] text-slate-400">
                        启动调查后，服务端工具会返回脱敏记录与稳定证据 ID。
                      </p>
                    </div>
                  )}

                  {result && (
                    <div className="rounded-xl border bg-white">
                      <button
                        type="button"
                        onClick={() => setShowAudit((value) => !value)}
                        className="flex w-full items-center justify-between px-5 py-3.5 text-left"
                      >
                        <span className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                          <LockKeyhole className="size-3.5 text-teal-700" />
                          审计记录与工具轨迹
                        </span>
                        <span className="text-[10px] font-medium text-teal-700">
                          {showAudit ? '收起' : `查看 ${result.toolTraces.length} 次调用`}
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
                                  <p className="truncate text-[10px] font-medium text-slate-700">{trace.label}</p>
                                  <p className="mt-0.5 font-mono text-[8px] text-slate-400">{trace.name}</p>
                                </div>
                                <span
                                  className={`ml-2 text-[9px] font-semibold ${
                                    trace.status === 'OK' ? 'text-emerald-700' : 'text-slate-400'
                                  }`}
                                >
                                  {trace.status} · {trace.recordCount}
                                </span>
                              </div>
                            ))}
                          </div>
                          <div className="mt-4 space-y-2 border-l border-slate-200 pl-3">
                            {result.auditEvents.map((event) => (
                              <div key={`${event.at}-${event.actor}`} className="flex gap-3 text-[10px]">
                                <time className="font-mono text-slate-400">{event.at}</time>
                                <span className="font-medium text-slate-700">{event.actor}</span>
                                <span className="text-slate-500">{event.action}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="rounded-xl border bg-white p-4 shadow-[0_6px_24px_rgb(15_23_42/4%)]">
                    <div className="flex items-center gap-2">
                      <Bot className="size-4 text-teal-700" />
                      <h3 className="text-sm font-semibold text-slate-900">AI 协同调查</h3>
                    </div>
                    <p className="mt-2 text-[11px] leading-[1.6] text-slate-500">
                      三个角色按顺序完成分类、证据核验和合规建议。
                    </p>

                    {(isRunning || result) && (
                      <div className="mt-4 space-y-2.5">
                        {runStages.map((stage, index) => {
                          const StageIcon = stage.icon;
                          const completed = result != null || runStep > index;
                          const active = isRunning && runStep === index;
                          return (
                            <div
                              key={stage.label}
                              className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
                                active
                                  ? 'border-teal-600/25 bg-teal-50'
                                  : completed
                                    ? 'border-emerald-600/15 bg-emerald-50/60'
                                    : 'bg-slate-50'
                              }`}
                            >
                              <div className="grid size-6 shrink-0 place-items-center rounded-md bg-white ring-1 ring-slate-900/5">
                                {active ? (
                                  <LoaderCircle className="size-3.5 animate-spin text-teal-700" />
                                ) : completed ? (
                                  <Check className="size-3.5 text-emerald-700" />
                                ) : (
                                  <StageIcon className="size-3.5 text-slate-400" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-[10px] font-semibold text-slate-700">{stage.label}</p>
                                <p className="truncate text-[9px] text-slate-400">{stage.detail}</p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {error && (
                      <div className="mt-3 rounded-lg bg-rose-50 p-2.5 text-[10px] text-rose-700">{error}</div>
                    )}

                    <Button
                      onClick={runInvestigation}
                      disabled={isRunning}
                      className="mt-4 h-9 w-full justify-between px-3 text-xs"
                    >
                      {isRunning ? '调查进行中…' : result ? '重新运行调查' : '开始 AI 调查'}
                      {isRunning ? (
                        <LoaderCircle data-icon="inline-end" className="animate-spin" />
                      ) : result ? (
                        <RotateCcw data-icon="inline-end" />
                      ) : (
                        <ArrowRight data-icon="inline-end" />
                      )}
                    </Button>
                    <p className="mt-2 text-center text-[10px] text-slate-400">录制结果模式 · 无需 API Key</p>
                  </div>

                  {result ? (
                    <div
                      className={`rounded-xl border p-4 ${
                        result.conflict.status === 'UNRESOLVED'
                          ? 'border-rose-200 bg-rose-50/70'
                          : 'border-amber-200 bg-amber-50/70'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        {result.conflict.status === 'UNRESOLVED' ? (
                          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-rose-700" />
                        ) : (
                          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
                        )}
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{result.conflict.title}</p>
                          <p className="mt-1.5 text-[11px] leading-[1.55] text-slate-600">
                            {result.conflict.resolution}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" />
                        <div>
                          <p className="text-xs font-semibold text-amber-900">客户主张不等于事实</p>
                          <p className="mt-1.5 text-[11px] leading-[1.55] text-amber-800/80">
                            调查前不预设责任，需要核验账务、交易与规则记录。
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border bg-white p-4">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
                      <ShieldCheck className="size-4 text-emerald-600" />
                      合规护栏
                    </div>
                    <ul className="mt-3 space-y-2 text-[10px] leading-4 text-slate-500">
                      <li className="flex gap-2">
                        <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />
                        仅读取模拟数据，不执行资金操作
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
                variant={result?.recommendation.state === 'MANDATORY_ESCALATION' ? 'destructive' : 'outline'}
                className={result ? 'text-slate-700' : 'text-slate-500'}
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
                      涉及金额 ¥{result.recommendation.amount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                    </p>
                  )}
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-slate-500">判断依据</p>
                  <p className="mt-2 text-[11px] leading-[1.7] text-slate-600">
                    {result.recommendation.rationale}
                  </p>
                </div>

                <div>
                  <p className="text-[10px] font-semibold text-slate-500">已确认事实</p>
                  <ul className="mt-2 space-y-2">
                    {result.confirmedFacts.map((fact) => (
                      <li key={fact} className="flex gap-2 text-[11px] leading-[1.55] text-slate-600">
                        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                        {fact}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border bg-slate-50 p-3">
                  <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-700">
                    <Gavel className="size-3.5 text-teal-700" />
                    {approvalLabels[result.approval.level]}
                  </div>
                  <p className="mt-1.5 text-[10px] leading-4 text-slate-500">{result.approval.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {result.recommendation.ruleIds.map((ruleId) => (
                      <span key={ruleId} className="rounded bg-white px-1.5 py-1 font-mono text-[8px] text-teal-700 ring-1 ring-slate-200">
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

                {(decision === 'approved' || decision === 'replied') && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-2 text-xs font-semibold text-emerald-900">
                        <ClipboardCheck className="size-4" />
                        客户回复草稿
                      </p>
                      <Button variant="ghost" size="xs" onClick={copyDraft} className="text-emerald-800">
                        {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                        {copied ? '已复制' : '复制'}
                      </Button>
                    </div>
                    <p className="mt-3 text-[11px] leading-[1.7] text-slate-600">{result.responseDraft}</p>
                  </div>
                )}

                {decision === 'returned' && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">
                    已退回事实调查环节；本演示不会自动修改原始证据或执行外部操作。
                  </div>
                )}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <FileCheck2 className="size-5" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-700">尚无处置建议</p>
              <p className="mt-2 max-w-[230px] text-[11px] leading-[1.65] text-slate-400">
                完成证据调查后，这里将展示责任判断、处理建议、风险边界与回复草稿。
              </p>
            </div>
          )}

          <div className="border-t bg-slate-50 p-4">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-500">人工决策</span>
              <span
                className={
                  decision === 'replied'
                    ? 'font-medium text-emerald-700'
                    : decision === 'approved'
                      ? 'font-medium text-teal-700'
                      : 'text-slate-400'
                }
              >
                {decision === 'replied'
                  ? '已完成回复'
                  : decision === 'approved'
                    ? '建议已批准'
                    : decision === 'returned'
                      ? '已退回补充'
                      : result
                        ? approvalLabels[result.approval.level]
                        : '未就绪'}
              </span>
            </div>

            {decision === 'approved' ? (
              <Button onClick={() => setDecision('replied')} className="mt-3 h-9 w-full text-xs">
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
                  disabled={!result || isRunning}
                  variant="outline"
                  onClick={() => setDecision('returned')}
                  className="h-9 text-xs"
                >
                  退回补充
                </Button>
                <Button
                  disabled={!result || isRunning}
                  onClick={() => setDecision('approved')}
                  className="h-9 text-xs"
                >
                  {result?.recommendation.state === 'MANDATORY_ESCALATION' ? '批准转办' : '批准建议'}
                </Button>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
