import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { fetchFredSeries, summarizeSeries } from '@/lib/clients/fred';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SERIES = {
  usdJpy: 'DEXJPUS',
  us10y: 'DGS10',
  vix: 'VIXCLS',
  sp500: 'SP500',
  nasdaq: 'NASDAQCOM',
  wti: 'DCOILWTICO',
} as const;

/**
 * GET /api/macro
 *  → { usdJpy: {latest, deltaPct, ...}, us10y, vix, sp500, nasdaq, wti }
 * 12時間キャッシュ。
 */
export async function GET() {
  try {
    const data = await withCache('macro:all', 12 * 60 * 60 * 1000, async () => {
      const entries = await Promise.all(
        Object.entries(SERIES).map(async ([key, sid]) => {
          try {
            const obs = await fetchFredSeries(sid, 30);
            return [key, summarizeSeries(obs)] as const;
          } catch {
            return [key, { latest: NaN, latestDate: '', deltaPct: null }] as const;
          }
        })
      );
      return Object.fromEntries(entries);
    });
    return jsonResponse(data, { sMaxAge: 12 * 60 * 60 });
  } catch (e) {
    return errorResponse(`macro fetch failed: ${(e as Error).message}`, 502);
  }
}
