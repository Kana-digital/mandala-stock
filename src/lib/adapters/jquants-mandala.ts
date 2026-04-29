/**
 * J-Quants 生データ → mandala-engine 入力（MandalaChart / MandalaSummary）への変換アダプタ
 *
 * このファイルが「J-Quants API の世界」と「mandala-engine の世界」の境界線。
 * mandala-engine は Yahoo / Stooq / J-Quants のいずれにも依存しない設計なので、
 * このアダプタが各データソースごとに用意される。
 *
 * J-Quants V2 のフィールド名は短縮形（O/H/L/C/Vo, Sales/OP/NP/EPS など）。
 * 株価は AdjC（調整済み終値）等を使い、分割影響を排除する。
 *
 * 無料プランは 12 週遅れだが、252 営業日のヒストリは取得できるので
 * RSI / MACD / 移動平均 / 52週レンジ などのテクニカル系は機能する。
 */

import type { JqDailyBar, JqFinSummary, JqEqMaster } from '@/lib/clients/jquants';
import type { MandalaChart, MandalaSummary, ChartBar } from '@/lib/mandala-engine';

/**
 * J-Quants 日足配列 → MandalaChart
 *
 * - 価格は AdjC（調整済み終値）を優先。分割対応のため必須。
 *   Adj* が無い古い日付では生値（O/H/L/C）にフォールバック。
 * - close が null の日はスキップ（取引停止日など）。
 */
export function quotesToChart(code: string, quotes: JqDailyBar[]): MandalaChart {
  const bars: ChartBar[] = [];
  for (const q of quotes) {
    const close = pick(q.AdjC, q.C);
    if (close == null) continue;
    const open = pick(q.AdjO, q.O, close);
    const high = pick(q.AdjH, q.H, close);
    const low = pick(q.AdjL, q.L, close);
    const volume = pick(q.AdjVo, q.Vo, 0) ?? 0;
    bars.push({
      date: q.Date,
      open: open ?? close,
      high: high ?? close,
      low: low ?? close,
      close,
      volume,
    });
  }
  // 日付昇順ソート（J-Quants は通常昇順だが念のため）
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));
  // J-Quants の Code は 5 桁。表示は 4 桁ベースで揃えるため code 引数優先
  return { ticker: `${code}.T`, bars };
}

/** 先頭から null/NaN でない最初の値を返す */
function pick(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) {
    if (v == null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * 文字列 / number / undefined → number | null
 * J-Quants の財務系数値フィールドは文字列で返ってくる（"100529000000" など）。
 * 空文字列は null 扱い。
 */
function num(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** statements を DiscDate 降順にソートして返す（最新が先頭） */
function sortStatementsDesc(stmts: JqFinSummary[]): JqFinSummary[] {
  return [...stmts].sort((a, b) => (a.DiscDate > b.DiscDate ? -1 : 1));
}

/**
 * 「財務諸表サマリー」として有効なレコードのみ抽出。
 *
 * /fins/summary は配当予想修正・業績予想修正など Sales/OP が空欄の開示も返すため、
 * Sales が数値として取れるものだけ採用する。
 */
function isFinancialStatement(s: JqFinSummary): boolean {
  return num(s.Sales) != null;
}

/**
 * 直近の決算と、その同四半期の前年実績を取り出して YoY を計算。
 *
 * - 「同 CurPerType」かつ「CurFYSt が前」の最新レコードを 1 年前の対応期として採用。
 * - 取れない場合は予想 vs 実績で代用。
 */
function buildFundamentals(stmts: JqFinSummary[]): {
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
  const filtered = stmts.filter(isFinancialStatement);
  if (filtered.length === 0) {
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

  const sorted = sortStatementsDesc(filtered);
  const latest = sorted[0];
  const totalRevenue = num(latest.Sales);
  const netIncome = num(latest.NP);
  const operatingProfit = num(latest.OP);
  const trailingEps = num(latest.EPS);
  const forwardEps = num(latest.FEPS);
  const forecastNetSales = num(latest.FSales);
  const forecastOperatingProfit = num(latest.FOP);

  // YoY: 同 CurPerType かつ CurFYSt が前の最新レコード
  let revenueGrowth: number | null = null;
  let earningsGrowth: number | null = null;
  const yoy = sorted.find(
    (s, i) =>
      i > 0 &&
      s.CurPerType === latest.CurPerType &&
      typeof s.CurFYSt === 'string' &&
      typeof latest.CurFYSt === 'string' &&
      s.CurFYSt < latest.CurFYSt,
  );
  if (yoy) {
    const prevRev = num(yoy.Sales);
    const prevProfit = num(yoy.NP);
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
 * - listedInfo: /equities/master から（会社名・業種・市場区分）
 * - statements: /fins/summary から（売上・利益・EPS・予想）
 * - lastClose: 直近終値（PER 計算に使用）
 */
export function buildMandalaSummary(args: {
  code: string;
  listedInfo: JqEqMaster | null;
  statements: JqFinSummary[];
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

  // 発行済株式数が statements の最新レコードに含まれていれば時価総額が出せる
  const latest = sortStatementsDesc(statements.filter(isFinancialStatement))[0];
  const sharesOutstanding = latest ? num(latest.ShOutFY) : null;
  const marketCap =
    sharesOutstanding != null && lastClose != null
      ? sharesOutstanding * lastClose
      : null;

  // BPS から PBR
  const bps = latest ? num(latest.BPS) : null;
  const priceToBook =
    bps != null && bps > 0 && lastClose != null ? lastClose / bps : null;

  // 自己資本比率（EqAR は 0〜1 のレシオで返ることが多い）→ 単純な健全性指標
  // mandala-engine の returnOnEquity を埋めるには純利益/純資産が必要
  // 純資産 Eq と純利益 NP があれば計算できる
  const eq = latest ? num(latest.Eq) : null;
  const np = latest ? num(latest.NP) : null;
  const returnOnEquity =
    eq != null && eq > 0 && np != null ? np / eq : null;

  const ta = latest ? num(latest.TA) : null;
  const returnOnAssets =
    ta != null && ta > 0 && np != null ? np / ta : null;

  // 配当利回り: 年間配当実績 / 直近終値
  const divAnn = latest ? num(latest.DivAnn) : null;
  const dividendYield =
    divAnn != null && divAnn > 0 && lastClose != null && lastClose > 0
      ? divAnn / lastClose
      : null;

  return {
    price: lastClose,
    currency: 'JPY',
    longName: listedInfo?.CoName ?? null,
    sector: listedInfo?.S33Nm ?? listedInfo?.S17Nm ?? null,
    industry: listedInfo?.S17Nm ?? null,

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
    grossMargins: null,
    operatingMargins: f.operatingMargin,
    profitMargins: f.profitMargin,

    // 健全性
    returnOnEquity,
    returnOnAssets,
    debtToEquity: null,
    currentRatio: null,
    quickRatio: null,

    // キャッシュフロー（CFO/CFI/CFF が summary にあるが
    // freeCashflow は CFO + CFI で近似可能。今は控えめに null）
    freeCashflow: null,
    operatingCashflow: null,

    // バリュエーション
    trailingPE,
    forwardPE,
    priceToBook,
    priceToSales: null,
    beta: null,
    marketCap,
    trailingEps: f.trailingEps,
    forwardEps: f.forwardEps,
    pegRatio: null,
    fiftyTwoWeekChange: null,

    // 配当
    dividendYield,
    payoutRatio: null,

    // 補助
    averageVolume: null,
    averageVolume10days: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    epsForecastCurrentYear: f.forwardEps,
  };
}
