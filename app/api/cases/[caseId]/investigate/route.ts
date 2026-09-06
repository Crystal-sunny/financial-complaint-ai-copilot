import type { InvestigationEvent, ProviderMode } from '@/lib/domain';
import {
  assertInvestigationProviderAllowed,
  CaseDataTransmissionPausedError,
} from '@/lib/server/case-data-policy';
import { mockDatabase } from '@/lib/server/mock-database';
import { investigateCase } from '@/lib/server/pipeline-orchestrator';
import { registerApprovalContext } from '@/lib/server/approval-context';

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
    if (!mockDatabase.cases.some((item) => item.caseId === caseId))
      return Response.json(
        { error: 'CASE_NOT_FOUND' },
        { status: 404, headers },
      );
    assertInvestigationProviderAllowed(provider, caseId);
    if (request.headers.get('accept')?.includes('application/x-ndjson')) {
      const abort = new AbortController();
      const signal = AbortSignal.any([request.signal, abort.signal]);
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (event: InvestigationEvent) => {
            if (!signal.aborted)
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          };
          try {
            const investigation = await investigateCase(caseId, {
              provider,
              signal,
              onEvent: send,
            });
            if (investigation) {
              registerApprovalContext(investigation);
              send({ type: 'completed', result: investigation });
            }
          } catch {
            send({
              type: 'error',
              message: '调查服务暂时不可用，请稍后重试。',
            });
          } finally {
            if (!abort.signal.aborted) controller.close();
          }
        },
        cancel() {
          abort.abort();
        },
      });
      return new Response(stream, {
        headers: {
          ...headers,
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    result = await investigateCase(caseId, {
      provider,
      signal: request.signal,
    });
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

  registerApprovalContext(result);
  return Response.json(result, {
    headers: {
      ...headers,
      'X-Execution-Mode': result.mode.toLowerCase(),
    },
  });
}
