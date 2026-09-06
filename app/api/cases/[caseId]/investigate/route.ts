import type { ProviderMode } from '@/lib/domain';
import { CaseDataTransmissionPausedError } from '@/lib/server/case-data-policy';
import { investigateCase } from '@/lib/server/pipeline-orchestrator';

export async function POST(
  request: Request,
  context: { params: Promise<{ caseId: string }> },
) {
  const { caseId } = await context.params;
  const headers = { 'Cache-Control': 'no-store' };
  let provider: ProviderMode = 'recorded';
  try {
    const text = await request.text();
    const body: unknown = text.trim() ? JSON.parse(text) : {};
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new Error('Invalid request');
    const requested = (body as { provider?: unknown }).provider;
    if (requested !== undefined) {
      if (
        typeof requested !== 'string' ||
        !['recorded', 'openai', 'glm'].includes(requested)
      )
        throw new Error('Invalid provider');
      provider = requested as ProviderMode;
    }
  } catch {
    return Response.json(
      { error: 'INVALID_REQUEST' },
      { status: 400, headers },
    );
  }
  let result;
  try {
    result = await investigateCase(caseId, { provider });
  } catch (error) {
    if (error instanceof CaseDataTransmissionPausedError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: 403, headers },
      );
    }
    throw error;
  }

  if (!result) {
    return Response.json({ error: 'CASE_NOT_FOUND' }, { status: 404, headers });
  }

  return Response.json(result, {
    headers: {
      ...headers,
      'X-Execution-Mode': result.mode.toLowerCase(),
    },
  });
}
