import { NextRequest } from 'next/server';
import { withCache, jsonResponse, errorResponse } from '@/lib/cache';
import { fetchDailyQuotes, fetchListedInfo, fetchStatements } from '@/lib/clients/jquants';
import { screenStock, type ScreenInput, type FundamentalSnapshot } from '@/lib/screening';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/screen?ticker=7203&analyst=3500
 *  → ScreenResult
 *
 * 1銘柄について価格・財務を取得 → ハイブリッドスコア + 3種ターゲット価格を返す。
 * 6時間キャッシュ（analyst パラメータは含めない＝同銘柄のスコアは共有）
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ticker = url.searchParams.get('ticker');
  const name = url.searchParams.get('name') ?? '';
  const analystStr = url.searchParams.get('analyst');
  const analyst = analystStr ? Number(analystStr) : undefined;

  if (!ticker || !/^\d{4,5}$/.test(ticker)) {
    return errorResponse('ticker query param required (4-5 digits)', 400);
  }

  try {
    const cached = await withCache(`screen:${ticker}`, 6 * 60 * 60 * 1000, async () => {
      const code = ticker.padEnd(5, '0');
      const to = new Date();
      const from = new Date(to.getTime() - 400 * 86400000);
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      const [info, quotes, statements] = await Promise.all([
        fetchListedInfo(code).catch(() => null),
        fetchDailyQuotes(code, fromStr, toStr),
        fetchStatements(code).catch(() => []),
      ]);

      const daily = quotes.map((q) => ({
        date: q.Date,
        o: q.Open,
        h: q.High,
        l: q.Low,
        c: q.Close,
        v: q.Volume,
      }));
      const lastClose = daily.length ? (daily[daily.length - 1].c ?? 0) : 0;

      // 財務: 直近 + 4期前 から YoY を計算
      const sorted = [...statements].sort((a, b) => (a.DisclosedDate < b.DisclosedDate ? 1 : -1));
      const latest = sorted[0];
      const yearAgo = sorted[4];
      const num = (s?: string) => (s == null || s === '' ? NaN : Number(s));

      const yoy = (cur: number, prev: number) =>
        Number.isFinite(cur) && Number.isFinite(prev) && prev !== 0
          ? ((cur - prev) / Math.abs(prev)) * 100
          : null;

      const fundamental: FundamentalSnapshot = {
        salesGrowthYoY: latest && yearAgo ? yoy(num(latest.NetSales), num(yearAgo.NetSales)) : null,
        opGrowthYoY: latest && yearAgo ? yoy(num(latest.OperatingProfit), num(yearAgo.OperatingProfit)) : null,
        epsGrowthYoY: latest && yearAgo ? yoy(num(latest.EarningsPerShare), num(yearAgo.EarningsPerShare)) : null,
        opMargin: latest && num(latest.NetSales) > 0 ? (num(latest.OperatingProfit) / num(latest.NetSales)) * 100 : null,
        forecastEPS: latest ? (Number.isFinite(num(latest.ForecastEarningsPerShare)) ? num(latest.ForecastEarningsPerShare) : null) : null,
        trailingEPS: latest ? (Number.isFinite(num(latest.EarningsPerShare)) ? num(latest.EarningsPerShare) : null) : null,
        sectorCode: info?.Sector33CodeName,
      };

      const input: ScreenInput = {
        ticker,
        name: name || info?.CompanyName || ticker,
        price: lastClose,
        daily,
        fundamental,
        analystTarget: analyst,
      };
      return screenStock(input);
    });

    // analyst 値だけは毎回上書き（キャッシュは共有可）
    if (analyst != null && cached) {
      const upside = (v: number) => cached.price > 0 ? ((v - cached.price) / cached.price) * 100 : null;
      cached.targets.analyst = { value: analyst, method: '手動入力', upside: upside(analyst) };
      const upsides = [
        cached.targets.technical.upside,
        cached.targets.fundamental.upside,
        cached.targets.analyst.upside,
      ].filter((x): x is number => x != null);
      cached.bestUpside = upsides.length ? Math.max(...upsides) : null;
    }

    return jsonResponse(cached, { sMaxAge: 6 * 60 * 60 });
  } catch (e) {
    return errorResponse(`screen failed: ${(e as Error).message}`, 502);
  }
}
