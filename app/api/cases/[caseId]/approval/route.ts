import { approveCase } from '@/lib/server/recorded-orchestrator';

export async function POST(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  const outcome = approveCase(caseId);

  if (!outcome) {
    return Response.json({ error: 'APPROVAL_NOT_FOUND' }, { status: 404 });
  }

  return Response.json(outcome, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
