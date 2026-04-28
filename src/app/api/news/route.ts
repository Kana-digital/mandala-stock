import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { fetchNews } from '@/lib/clients/news';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/news?q=トヨタ&days=7
 *  → { totalResults, articles: [...] }
 * 1時間キャッシュ。
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const days = Math.min(Number(url.searchParams.get('days') ?? '7'), 30);
  if (!q) return errorResponse('q query param required', 400);

  try {
    const data = await withCache(`news:${q}:${days}`, 60 * 60 * 1000, async () => {
      const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      return fetchNews(q, { from, pageSize: 20 });
    });
    return jsonResponse(data, { sMaxAge: 60 * 60 });
  } catch (e) {
    return errorResponse(`news fetch failed: ${(e as Error).message}`, 502);
  }
}
