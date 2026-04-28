import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { fetchAllListedInfo, fetchListedInfo, pickSameSector } from '@/lib/clients/jquants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/competitors?ticker=7203
 *  → { sector, competitors: [{Code, CompanyName, ...}, ...] }
 * 全銘柄リストは 24時間キャッシュ。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  if (!ticker || !/^\d{4,5}$/.test(ticker)) {
    return errorResponse('ticker query param required (4-5 digits)', 400);
  }

  try {
    const code = ticker.padEnd(5, '0');
    const data = await withCache(`competitors:${ticker}`, 24 * 60 * 60 * 1000, async () => {
      const [target, all] = await Promise.all([
        fetchListedInfo(code),
        fetchAllListedInfo(),
      ]);
      if (!target) return { sector: null, competitors: [] };
      return {
        sector: target.Sector33CodeName ?? null,
        competitors: pickSameSector(all, target, 5),
      };
    });
    return jsonResponse(data, { sMaxAge: 24 * 60 * 60 });
  } catch (e) {
    return errorResponse(`competitors fetch failed: ${(e as Error).message}`, 502);
  }
}
