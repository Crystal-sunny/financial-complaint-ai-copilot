import { listCases } from '@/lib/server/recorded-orchestrator';

export async function GET() {
  return Response.json({ cases: listCases(), dataMode: 'SIMULATED' });
}
