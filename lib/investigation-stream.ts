import type { InvestigationEvent, InvestigationResult } from './domain';

// Decode across arbitrary network/UTF-8 chunk boundaries. Only a completed,
// server-validated result may become the current investigation.
export async function readInvestigationStream(
  response: Response,
  onEvent: (event: InvestigationEvent) => void,
): Promise<InvestigationResult> {
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? '当前案件尚未启用模型外发，请使用稳定模式。'
        : '调查服务暂时不可用',
    );
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson'))
    return response.json() as Promise<InvestigationResult>;
  if (!response.body) throw new Error('调查进度连接不可用');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: InvestigationResult | null = null;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as InvestigationEvent;
    if (event.type === 'error') throw new Error(event.message);
    if (event.type === 'completed') result = event.result;
    onEvent(event);
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!result) throw new Error('调查连接已中断，未收到完整结果，请重试。');
    return result;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
