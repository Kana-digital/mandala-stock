import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { recentLargeShareholderReports } from '@/lib/clients/edinet';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/attention?ticker=7203&days=30
 *  → { largeShareholderReports: [...], reportCount }
 * 24時間キャッシュ。EDINET API は重いので投げっぱなしにしない。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const days = Math.min(Number(url.searchParams.get('days') ?? '30'), 90);
  if (!ticker || !/^\d{4,5}$/.test(ticker)) {
    return errorResponse('ticker query param required (4-5 digits)', 400);
  }
  try {
    const data = await withCache(`attention:${ticker}:${days}`, 24 * 60 * 60 * 1000, async () => {
      const reports = await recentLargeShareholderReports(ticker, days);
      return { largeShareholderReports: reports, reportCount: reports.length };
    });
    return jsonResponse(data, { sMaxAge: 24 * 60 * 60 });
  } catch (e) {
    return errorResponse(`attention fetch failed: ${(e as Error).message}`, 502);
  }
}
