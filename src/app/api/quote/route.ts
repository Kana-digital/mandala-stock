import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { fetchDailyQuotes, fetchListedInfo } from '@/lib/clients/jquants';

// 個人利用 / API キー必須なので Edge ではなく Node ランタイム
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/quote?ticker=7203&days=180
 *  → { info, daily: [{date,o,h,l,c,v}, ...] }
 *
 * 価格データは J-Quants 由来。20分キャッシュ。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const days = Math.min(Number(url.searchParams.get('days') ?? '180'), 1000);

  if (!ticker || !/^\d{4,5}$/.test(ticker)) {
    return errorResponse('ticker query param required (4-5 digits)', 400);
  }

  try {
    const data = await withCache(`quote:${ticker}:${days}`, 20 * 60 * 1000, async () => {
      const code = ticker.padEnd(5, '0');
      const to = new Date();
      const from = new Date(to.getTime() - days * 86400000);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);
      const [info, quotes] = await Promise.all([
        fetchListedInfo(code).catch(() => null),
        fetchDailyQuotes(code, fromStr, toStr),
      ]);
      const daily = quotes.map((q) => ({
        date: q.Date,
        o: q.Open, h: q.High, l: q.Low, c: q.Close, v: q.Volume,
      }));
      return { info, daily };
    });
    return jsonResponse(data, { sMaxAge: 1200 });
  } catch (e) {
    return errorResponse(`quote fetch failed: ${(e as Error).message}`, 502);
  }
}
