import { investigateCase } from '@/lib/server/recorded-orchestrator';

export async function POST(
  _request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  const result = investigateCase(caseId);

  if (!result) {
    return Response.json({ error: 'CASE_NOT_FOUND' }, { status: 404 });
  }

  return Response.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Demo-Mode': 'recorded',
    },
  });
}
