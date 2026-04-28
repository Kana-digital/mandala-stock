import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/cache';
import {
  kvGet,
  KV_KEYS,
  isKvEnabled,
  type SlimRankingEntry,
  type SlimRankingMeta,
} from '@/lib/clients/kv';
import { UNIVERSE } from '@/lib/universe';
import type { MandalaResult } from '@/lib/mandala-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/ranking?limit=20&sortBy=predicted|analyst|total&offset=0
 *
 * 読み取り順:
 *   1. ranking:slim:meta があればチャンク版（全銘柄スケール）
 *   2. なければ ranking:all（80銘柄レガシー）
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20'), 5), 500);
  const offset = Math.max(Number(url.searchParams.get('offset') ?? '0'), 0);
  const sortBy = (url.searchParams.get('sortBy') ?? 'predicted') as 'predicted' | 'analyst' | 'total';

  if (!isKvEnabled()) {
    return errorResponse(
      'KV not configured. Vercel に UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を設定してください',
      503,
    );
  }

  try {
    const slimMeta = await kvGet<SlimRankingMeta>(KV_KEYS.rankingSlimMeta());

    if (slimMeta && slimMeta.chunkCount > 0) {
      // ---- 新形式: チャンク版スリムランキング ----
      // 必要な分だけチャンクを読む（offset+limit までで打ち切り）
      const lastIdx = Math.min(offset + limit, slimMeta.totalCount);
      const startChunk = Math.floor(offset / slimMeta.chunkSize);
      const endChunk = Math.floor((lastIdx - 1) / slimMeta.chunkSize);

      const chunkPromises: Promise<SlimRankingEntry[] | null>[] = [];
      for (let i = startChunk; i <= endChunk; i++) {
        chunkPromises.push(kvGet<SlimRankingEntry[]>(KV_KEYS.rankingSlimChunk(i)));
      }
      const chunks = await Promise.all(chunkPromises);
      const all: SlimRankingEntry[] = [];
      for (const c of chunks) if (c) all.push(...c);

      // ranking はすでに totalScore 降順でソート済みだが、別ソートが要求されたら再ソート
      const sorted = sortBy === 'total'
        ? all
        : [...all].sort((a, b) => {
            if (sortBy === 'analyst') {
              return (b.analystUpsidePct ?? -Infinity) - (a.analystUpsidePct ?? -Infinity);
            }
            return b.predictedUpsidePct - a.predictedUpsidePct;
          });

      const sliceStart = offset - startChunk * slimMeta.chunkSize;
      const items = sorted.slice(sliceStart, sliceStart + limit).map((e) => ({
        ticker: `${e.code}.T`,
        ...e,
      }));

      return jsonResponse(
        {
          total: slimMeta.totalCount,
          universeSize: UNIVERSE.length,
          generatedAt: slimMeta.generatedAt,
          sortBy,
          offset,
          limit,
          items,
        },
        { sMaxAge: 30 * 60 },
      );
    }

    // ---- レガシー: ranking:all（80銘柄時代）----
    const all = await kvGet<MandalaResult[]>(KV_KEYS.rankingAll());
    if (!all || all.length === 0) {
      return errorResponse(
        'No data yet. `npm run refresh` を実行してデータを生成してください',
        503,
      );
    }

    const lastRefreshedAt = await kvGet<string>(KV_KEYS.lastRefreshedAt());

    const sorted = [...all].sort((a, b) => {
      if (sortBy === 'analyst') {
        return (b.analystUpsidePct ?? -Infinity) - (a.analystUpsidePct ?? -Infinity);
      }
      if (sortBy === 'total') {
        return b.totalScore - a.totalScore;
      }
      return b.predictedUpsidePct - a.predictedUpsidePct;
    });

    const slim = sorted.slice(offset, offset + limit).map((r) => ({
      ticker: r.ticker,
      code: r.code,
      name: r.name,
      sector: r.sector,
      price: r.price ?? null,
      predictedPrice: r.predictedPrice ?? null,
      predictedUpsidePct: r.predictedUpsidePct,
      analystUpsidePct: r.analystUpsidePct ?? null,
      totalScore: r.totalScore,
      categoryScores: r.categories.map((c) => ({ key: c.key, name: c.name, score: c.score })),
    }));

    return jsonResponse(
      {
        total: all.length,
        universeSize: UNIVERSE.length,
        generatedAt: lastRefreshedAt ?? new Date().toISOString(),
        sortBy,
        offset,
        limit,
        items: slim,
      },
      { sMaxAge: 30 * 60 },
    );
  } catch (e) {
    return errorResponse(`ranking failed: ${(e as Error).message}`, 502);
  }
}
