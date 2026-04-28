import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { interestOverTime } from '@/lib/clients/trends';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/trends?keyword=トヨタ
 *  → { points: [...], mock: true|false }
 * 6時間キャッシュ。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const keyword = url.searchParams.get('keyword');
  if (!keyword) return errorResponse('keyword query param required', 400);

  try {
    const data = await withCache(`trends:${keyword}`, 6 * 60 * 60 * 1000, async () => interestOverTime(keyword));
    return jsonResponse(data, { sMaxAge: 6 * 60 * 60 });
  } catch (e) {
    return errorResponse(`trends fetch failed: ${(e as Error).message}`, 502);
  }
}
