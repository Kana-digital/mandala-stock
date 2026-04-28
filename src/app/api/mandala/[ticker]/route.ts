import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/cache';
import { kvGet, KV_KEYS, isKvEnabled } from '@/lib/clients/kv';
import type { MandalaResult } from '@/lib/mandala-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/mandala/<code>
 *  → MandalaResult (81 セル全部入り)
 *
 * Upstash Redis から事前計算済みのマンダラを読み出すだけ。
 * データは scripts/refresh.ts （Mac or GH Actions 上）で生成。
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ ticker: string }> }) {
  const params = await ctx.params;
  const code = params.ticker.replace(/\.T$/, '').padStart(4, '0');

  if (!/^\d{4,5}$/.test(code)) {
    return errorResponse('ticker must be a 4-5 digit code', 400);
  }

  if (!isKvEnabled()) {
    return errorResponse(
      'KV not configured. Vercel に UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN を設定してください',
      503,
    );
  }

  try {
    const result = await kvGet<MandalaResult>(KV_KEYS.mandala(code));
    if (!result) {
      return errorResponse(`No data for ${code}. データがまだ生成されていません`, 404);
    }
    return jsonResponse(result, { sMaxAge: 4 * 60 * 60 });
  } catch (e) {
    return errorResponse(`mandala failed: ${(e as Error).message}`, 502);
  }
}
