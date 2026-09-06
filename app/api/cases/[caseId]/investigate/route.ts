import type { ProviderMode } from '@/lib/domain';
import { investigateCase } from '@/lib/server/pipeline-orchestrator';

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  let provider: ProviderMode = 'recorded';
  try {
    const body = (await request.json()) as { provider?: ProviderMode };
    if (body.provider === 'openai') provider = 'openai';
  } catch {
    // Empty request bodies use the stable provider.
  }
  const result = await investigateCase(caseId, { provider });

  if (!result) {
    return Response.json({ error: 'CASE_NOT_FOUND' }, { status: 404 });
  }

  return Response.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Execution-Mode': result.mode.toLowerCase(),
    },
  });
}
