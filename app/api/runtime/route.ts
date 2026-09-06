import { getRuntimeCapabilities } from '@/lib/server/model-provider';

export async function GET() {
  return Response.json(getRuntimeCapabilities(), {
    headers: { 'Cache-Control': 'no-store' },
  });
}
