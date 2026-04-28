/**
 * Yahoo Finance クライアント (サーバーサイド専用)
 *
 * yahoo-finance2 npm を利用。
 * crumb cookie / consent ハンドシェイクを内部で自動処理してくれるので、
 * Vercel/AWS などのクラウド IP からも 429 を回避できる。
 *
 * 日本株は `<code>.T` 形式 (例: 7203.T = トヨタ)。
 */

import yahooFinance from 'yahoo-finance2';

// バリデーション無効化（型のずれは許容して落ちないようにする）
yahooFinance.setGlobalConfig({
  validation: { logErrors: false, logOptionsErrors: false },
});
// survey notice 等のサーベイログを抑制
yahooFinance.suppressNotices(['yahooSurvey', 'ripHistorical']);

export interface YfBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YfChart {
  ticker: string;
  currency: string | null;
  bars: YfBar[];
  meta: {
    regularMarketPrice: number | null;
    longName: string | null;
    shortName: string | null;
  };
}

/** 株価チャート（日足） */
export async function yfChart(
  ticker: string,
  range: '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y' = '1y',
): Promise<YfChart> {
  const result = await yahooFinance.chart(ticker, {
    period1: rangeToDate(range),
    period2: new Date(),
    interval: '1d',
    return: 'array',
  });

  // ChartResultArray.quotes: { date, open, high, low, close, volume, adjclose }[]
  const quotes = (result.quotes ?? []) as Array<{
    date: Date | string | number;
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
    volume?: number | null;
  }>;
  const meta = result.meta as {
    currency?: string;
    regularMarketPrice?: number;
    longName?: string;
    shortName?: string;
  } | undefined;

  const bars: YfBar[] = quotes
    .filter((q) => q.close != null)
    .map((q) => ({
      date: (q.date instanceof Date ? q.date : new Date(q.date)).toISOString().slice(0, 10),
      open: q.open ?? q.close ?? 0,
      high: q.high ?? q.close ?? 0,
      low: q.low ?? q.close ?? 0,
      close: q.close ?? 0,
      volume: q.volume ?? 0,
    }));

  return {
    ticker,
    currency: meta?.currency ?? null,
    bars,
    meta: {
      regularMarketPrice: meta?.regularMarketPrice ?? null,
      longName: meta?.longName ?? null,
      shortName: meta?.shortName ?? null,
    },
  };
}

function rangeToDate(range: '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y'): Date {
  const days = { '1mo': 30, '3mo': 90, '6mo': 180, '1y': 365, '2y': 730, '5y': 1825 }[range];
  return new Date(Date.now() - days * 86400000);
}

export interface YfSummary {
  ticker: string;
  price: number | null;
  currency: string | null;
  longName: string | null;
  sector: string | null;
  industry: string | null;

  // financialData
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  totalRevenue: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;

  // defaultKeyStatistics
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  beta: number | null;
  marketCap: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  pegRatio: number | null;
  fiftyTwoWeekChange: number | null;

  // summaryDetail
  dividendYield: number | null;
  payoutRatio: number | null;
  averageVolume: number | null;
  averageVolume10days: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;

  // earningsTrend
  epsForecastCurrentYear: number | null;
}

// 取得した結果の型を緩める
type AnyMap = Record<string, unknown>;

// helper: number | { raw: number } | undefined を number|null に
function pick(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v === 'object' && 'raw' in v && typeof (v as { raw: unknown }).raw === 'number') {
    return (v as { raw: number }).raw;
  }
  return null;
}

function pickStr(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

export async function yfQuoteSummary(ticker: string): Promise<YfSummary> {
  const r = (await yahooFinance.quoteSummary(ticker, {
    modules: [
      'financialData',
      'defaultKeyStatistics',
      'summaryDetail',
      'summaryProfile',
      'price',
      'earningsTrend',
    ],
  })) as unknown as AnyMap;

  const fd: AnyMap = (r.financialData as AnyMap | undefined) ?? {};
  const ks: AnyMap = (r.defaultKeyStatistics as AnyMap | undefined) ?? {};
  const sd: AnyMap = (r.summaryDetail as AnyMap | undefined) ?? {};
  const sp: AnyMap = (r.summaryProfile as AnyMap | undefined) ?? {};
  const pr: AnyMap = (r.price as AnyMap | undefined) ?? {};
  const et: AnyMap = (r.earningsTrend as AnyMap | undefined) ?? {};

  type Trend = { period?: string; earningsEstimate?: { avg?: unknown } };
  const trend: Trend[] = (et.trend as Trend[] | undefined) ?? [];
  const yearTrend = trend.find((t) => t.period === '0y');

  return {
    ticker,
    price: pick(pr.regularMarketPrice) ?? pick(sd.regularMarketPrice),
    currency: pickStr(pr.currency),
    longName: pickStr(pr.longName) ?? pickStr(pr.shortName),
    sector: pickStr(sp.sector),
    industry: pickStr(sp.industry),

    targetMeanPrice: pick(fd.targetMeanPrice),
    targetHighPrice: pick(fd.targetHighPrice),
    targetLowPrice: pick(fd.targetLowPrice),
    recommendationMean: pick(fd.recommendationMean),
    numberOfAnalystOpinions: pick(fd.numberOfAnalystOpinions),
    totalRevenue: pick(fd.totalRevenue),
    revenueGrowth: pick(fd.revenueGrowth),
    earningsGrowth: pick(fd.earningsGrowth),
    grossMargins: pick(fd.grossMargins),
    operatingMargins: pick(fd.operatingMargins),
    profitMargins: pick(fd.profitMargins),
    returnOnEquity: pick(fd.returnOnEquity),
    returnOnAssets: pick(fd.returnOnAssets),
    debtToEquity: pick(fd.debtToEquity),
    currentRatio: pick(fd.currentRatio),
    quickRatio: pick(fd.quickRatio),
    freeCashflow: pick(fd.freeCashflow),
    operatingCashflow: pick(fd.operatingCashflow),

    trailingPE: pick(ks.trailingPE) ?? pick(sd.trailingPE),
    forwardPE: pick(ks.forwardPE) ?? pick(sd.forwardPE),
    priceToBook: pick(ks.priceToBook),
    priceToSales: pick(ks.priceToSalesTrailing12Months) ?? pick(sd.priceToSalesTrailing12Months),
    beta: pick(ks.beta) ?? pick(sd.beta),
    marketCap: pick(ks.marketCap) ?? pick(pr.marketCap),
    trailingEps: pick(ks.trailingEps),
    forwardEps: pick(ks.forwardEps),
    pegRatio: pick(ks.pegRatio),
    fiftyTwoWeekChange: pick((ks as AnyMap)['52WeekChange']),

    dividendYield: pick(sd.dividendYield),
    payoutRatio: pick(sd.payoutRatio),
    averageVolume: pick(sd.averageVolume),
    averageVolume10days: pick(sd.averageVolume10days),
    fiftyTwoWeekHigh: pick(sd.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: pick(sd.fiftyTwoWeekLow),

    epsForecastCurrentYear: pick(yearTrend?.earningsEstimate?.avg),
  };
}
