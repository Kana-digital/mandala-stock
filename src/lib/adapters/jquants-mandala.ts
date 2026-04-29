/**
 * J-Quants 生データ → mandala-engine 入力（MandalaChart / MandalaSummary）への変換アダプタ
 *
 * このファイルが「J-Quants API の世界」と「mandala-engine の世界」の境界線。
 * mandala-engine は Yahoo / Stooq / J-Quants のいずれにも依存しない設計なので、
 * このアダプタが各データソースごとに用意される（将来 Stooq Premium に戻す場合は
 * stooq-mandala.ts のような形で追加）。
 *
 * J-Quants 無料プランは 12 週遅れだが、252 営業日のヒストリは取得できるので
 * RSI / MACD / 移動平均 / 52週レンジ などのテクニカル系は機能する。
 *
 * ファンダメンタル側は /fins/statements の最新四半期から PER / ROE / 利益率等を
 * 計算可能な範囲で合成。calculation by hand のため Yahoo 提供時より粗くなるが、
 * 主要指標は埋まる。
 */

import type { JqDailyQuote, JqStatement, JqListedInfo } from '@/lib/clients/jquants';
import type { MandalaChart, MandalaSummary, ChartBar } from '@/lib/mandala-engine';

/**
 * J-Quants 日足配列 → MandalaChart
 * - 価格は J-Quants の終値（円）。Adjustment 後の値が来る前提。
 * - null 値の日はスキップ（休場・出来高ゼロは Volume=0 で残す）。
 */
export function quotesToChart(code: string, quotes: JqDailyQuote[]): MandalaChart {
  const bars: ChartBar[] = [];
  for (const q of quotes) {
    if (q.Close == null || !Number.isFinite(q.Close)) continue;
    bars.push({
      date: q.Date,
      open: Number.isFinite(q.Open as number) ? (q.Open as number) : (q.Close as number),
      high: Number.isFinite(q.High as number) ? (q.High as number) : (q.Close as number),
      low: Number.isFinite(q.Low as number) ? (q.Low as number) : (q.Close as number),
      close: q.Close as number,
      volume: Number.isFinite(q.Volume as number) ? (q.Volume as number) : 0,
    });
  }
  // 日付昇順ソート（J-Quants は通常昇順だが念のため）
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { ticker: `${code}.T`, bars };
}

/**
 * 文字列 / number / undefined → number | null
 * J-Quants の数値フィールドは文字列で返ってくることがある。
 */
function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** statements を DisclosedDate 降順にソートして返す（最新が先頭） */
function sortStatementsDesc(stmts: JqStatement[]): JqStatement[] {
  return [...stmts].sort((a, b) => (a.DisclosedDate > b.DisclosedDate ? -1 : 1));
}

/**
 * 同一銘柄の最新 4 四半期（≒ 1 年分）の statement から TTM (trailing-twelve-month) 集計
 * - 1 年前比の成長率を計算（YoY）
 * - 利益率（営業利益率・純利益率）も計算
 *
 * J-Quants の statement は四半期累計（YTD）で来るケースと単四半期で来るケースが
 * 混在する仕様なので、安全に行くために「最新の年次／通期実績」がある場合はそれを優先、
 * 無ければ最新四半期だけ使うフォールバックにする。
 */
function buildFundamentals(stmts: JqStatement[]): {
  totalRevenue: number | null;
  netIncome: number | null;
  operatingProfit: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  forecastNetSales: number | null;
  forecastOperatingProfit: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
} {
  if (stmts.length === 0) {
    return {
      totalRevenue: null,
      netIncome: null,
      operatingProfit: null,
      trailingEps: null,
      forwardEps: null,
      forecastNetSales: null,
      forecastOperatingProfit: null,
      revenueGrowth: null,
      earningsGrowth: null,
      operatingMargin: null,
      profitMargin: null,
    };
  }

  const sorted = sortStatementsDesc(stmts);
  const latest = sorted[0];
  const totalRevenue = num(latest.NetSales);
  const netIncome = num(latest.Profit);
  const operatingProfit = num(latest.OperatingProfit);
  const trailingEps = num(latest.EarningsPerShare);
  const forwardEps = num(latest.ForecastEarningsPerShare);
  const forecastNetSales = num(latest.ForecastNetSales);
  const forecastOperatingProfit = num(latest.ForecastOperatingProfit);

  // 1 年前(≒4 四半期前)の statement を探して YoY 成長率を計算
  let revenueGrowth: number | null = null;
  let earningsGrowth: number | null = null;
  if (sorted.length >= 5) {
    const prev = sorted[4]; // 5 番目 ≒ 1 年前
    const prevRev = num(prev.NetSales);
    const prevProfit = num(prev.Profit);
    if (prevRev != null && prevRev !== 0 && totalRevenue != null) {
      revenueGrowth = (totalRevenue - prevRev) / Math.abs(prevRev);
    }
    if (prevProfit != null && prevProfit !== 0 && netIncome != null) {
      earningsGrowth = (netIncome - prevProfit) / Math.abs(prevProfit);
    }
  } else {
    // フォールバック: 業績予想 vs 実績で代用
    if (forecastNetSales != null && totalRevenue != null && totalRevenue !== 0) {
      revenueGrowth = (forecastNetSales - totalRevenue) / Math.abs(totalRevenue);
    }
    if (forecastOperatingProfit != null && operatingProfit != null && operatingProfit !== 0) {
      earningsGrowth = (forecastOperatingProfit - operatingProfit) / Math.abs(operatingProfit);
    }
  }

  const operatingMargin =
    operatingProfit != null && totalRevenue != null && totalRevenue !== 0
      ? operatingProfit / totalRevenue
      : null;
  const profitMargin =
    netIncome != null && totalRevenue != null && totalRevenue !== 0
      ? netIncome / totalRevenue
      : null;

  return {
    totalRevenue,
    netIncome,
    operatingProfit,
    trailingEps,
    forwardEps,
    forecastNetSales,
    forecastOperatingProfit,
    revenueGrowth,
    earningsGrowth,
    operatingMargin,
    profitMargin,
  };
}

/**
 * J-Quants の各種データから MandalaSummary を合成する。
 *
 * - listedInfo: /listed/info から（業種名）
 * - statements: /fins/statements から（売上・利益・EPS）
 * - lastClose: 直近終値（PER 計算に使用）
 *
 * J-Quants 無料プランで取得できないフィールド（PBR / ROE / D/E / β など）は null。
 * mandala-engine 側で null セルは「データ未取得」として扱われる。
 */
export function buildMandalaSummary(args: {
  code: string;
  listedInfo: JqListedInfo | null;
  statements: JqStatement[];
  lastClose: number | null;
}): MandalaSummary {
  const { listedInfo, statements, lastClose } = args;
  const f = buildFundamentals(statements);

  // PER 計算: 直近終値 / EPS
  const trailingPE =
    lastClose != null && f.trailingEps != null && f.trailingEps > 0
      ? lastClose / f.trailingEps
      : null;
  const forwardPE =
    lastClose != null && f.forwardEps != null && f.forwardEps > 0
      ? lastClose / f.forwardEps
      : null;

  return {
    price: lastClose,
    currency: 'JPY',
    longName: listedInfo?.CompanyName ?? null,
    sector: listedInfo?.Sector33CodeName ?? listedInfo?.Sector17CodeName ?? null,
    industry: listedInfo?.Sector17CodeName ?? null,

    // アナリスト系（J-Quants 無料には無い）
    targetMeanPrice: null,
    targetHighPrice: null,
    targetLowPrice: null,
    recommendationMean: null,
    numberOfAnalystOpinions: null,

    // 売上・利益関連
    totalRevenue: f.totalRevenue,
    revenueGrowth: f.revenueGrowth,
    earningsGrowth: f.earningsGrowth,
    grossMargins: null, // J-Quants には粗利の詳細が無い
    operatingMargins: f.operatingMargin,
    profitMargins: f.profitMargin,

    // ROE / ROA は純資産・総資産が必要 → 無料 statement には無い
    returnOnEquity: null,
    returnOnAssets: null,
    debtToEquity: null,
    currentRatio: null,
    quickRatio: null,

    // キャッシュフロー（statement に項目があれば追加可だが現状は null）
    freeCashflow: null,
    operatingCashflow: null,

    // バリュエーション
    trailingPE,
    forwardPE,
    priceToBook: null,
    priceToSales: null,
    beta: null,
    marketCap: null, // 発行株数が無いので算出不可
    trailingEps: f.trailingEps,
    forwardEps: f.forwardEps,
    pegRatio: null,
    fiftyTwoWeekChange: null,

    // 配当
    dividendYield: null,
    payoutRatio: null,

    // 補助
    averageVolume: null,
    averageVolume10days: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    epsForecastCurrentYear: f.forwardEps,
  };
}
