import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse, cacheSet } from '@/lib/cache';
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
 * Vercel Cron で日次実行（vercel.json の crons 設定と対応）
 *  - FRED マクロデータを温め直す
 *  - Vercel Cron は 'authorization: Bearer <CRON_SECRET>' を付けて呼ぶ
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return errorResponse('unauthorized', 401);
  }
  try {
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
    const data = Object.fromEntries(entries);
    cacheSet('macro:all', data, 12 * 60 * 60 * 1000);
    return jsonResponse({ ok: true, warmed: Object.keys(data) });
  } catch (e) {
    return errorResponse(`cron failed: ${(e as Error).message}`, 500);
  }
}
