import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { fetchStatements } from '@/lib/clients/jquants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/fundamental?ticker=7203
 *  → { latest, history }
 * 6時間キャッシュ。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker || !/^\d{4,5}$/.test(ticker)) {
    return errorResponse('ticker query param required (4-5 digits)', 400);
  }

  try {
    const data = await withCache(`fundamental:${ticker}`, 6 * 60 * 60 * 1000, async () => {
      const code = ticker.padEnd(5, '0');
      const statements = await fetchStatements(code);
      const sorted = [...statements].sort((a, b) => (a.DiscDate < b.DiscDate ? 1 : -1));
      return { latest: sorted[0] ?? null, history: sorted.slice(0, 12) };
    });
    return jsonResponse(data, { sMaxAge: 6 * 60 * 60 });
  } catch (e) {
    return errorResponse(`fundamental fetch failed: ${(e as Error).message}`, 502);
  }
}
