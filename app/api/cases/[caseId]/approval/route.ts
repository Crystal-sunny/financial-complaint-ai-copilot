import { approveValidatedInvestigation } from '@/lib/server/approval-context';

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  let runId = '';
  try {
    const body = (await request.json()) as { runId?: unknown };
    if (typeof body?.runId === 'string') runId = body.runId;
  } catch {
    /* Missing context must never use a predefined approval. */
  }
  const outcome = approveValidatedInvestigation(caseId, runId);

  if (!outcome) {
    return Response.json(
      {
        error: 'INVESTIGATION_REVIEW_REQUIRED',
        message: '当前调查需要补充核验，不能直接生成审批结论。',
      },
      { status: 409, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return Response.json(outcome, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
