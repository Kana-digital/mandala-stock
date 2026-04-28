/**
 * 9x9 曼荼羅チャート計算エンジン
 *
 * 構造:
 *  - 中央 3x3: 銘柄情報セル(中心) + 8 カテゴリ総合点
 *  - 周囲の 8 つの 3x3: 各カテゴリの 9 セル詳細（中央=カテゴリ名+点、周囲8=指標）
 *
 * 全 81 セルにラベル・値・スコア(0-100)・コメントを持たせる。
 * ランキングは「8 カテゴリ総合点の合計（最大 800）」でソート。
 */

import type { YfChart, YfSummary } from './clients/yahoo';
import {
  ema,
  macd,
  periodReturn,
  range52w,
  rsi,
  sma,
  volatility,
  volumeRatio,
} from './indicators';

export type CategoryKey =
  | 'growth'
  | 'profitability'
  | 'valuation'
  | 'health'
  | 'momentum'
  | 'technical'
  | 'volume'
  | 'forecast';

export interface MandalaCell {
  /** 表示ラベル */
  label: string;
  /** 数値（適切な単位ですでに整形済の文字列） */
  display: string;
  /** 0-100 スコア（指標自体に意味がある場合のみ。中央セル等は null） */
  score: number | null;
  /** ローデータ（チャート等に使う） */
  raw?: number | null;
  /** 短いコメント or 説明 */
  hint?: string;
}

export interface CategoryBlock {
  key: CategoryKey;
  name: string;
  /** 8 指標の平均で算出する 0-100 のカテゴリスコア */
  score: number;
  /** 9 セル: index 4 が中央(カテゴリ要約)、それ以外が指標 */
  cells: MandalaCell[];
}

export interface MandalaResult {
  ticker: string;
  code: string; // 4桁コード
  name: string;
  sector: string | null;
  /** 現在株価 */
  price: number;
  /** アナリストコンセンサスtarget */
  targetMeanPrice: number | null;
  /** 上昇率% (target / price - 1) * 100 */
  analystUpsidePct: number | null;
  /** 計算ベースの予測株価（ファンダメンタル+テクニカルのハイブリッド） */
  predictedPrice: number;
  /** 予測上昇率% */
  predictedUpsidePct: number;
  /** 8 カテゴリ */
  categories: CategoryBlock[];
  /** 中央 3x3 (9 セル: 中央=銘柄、周囲=8 カテゴリ点) */
  centerCells: MandalaCell[];
  /** 8 カテゴリ点合計（0-800） */
  totalScore: number;
}

// ───────────────────────── ヘルパ ─────────────────────────

const fmt = {
  pct: (v: number | null, digits = 1): string =>
    v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`,
  pctRaw: (v: number | null, digits = 1): string =>
    v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}%`,
  num: (v: number | null, digits = 2): string =>
    v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits),
  yen: (v: number | null): string => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}兆円`;
    if (v >= 1e8) return `${(v / 1e8).toFixed(0)}億円`;
    if (v >= 1e4) return `${(v / 1e4).toFixed(0)}万円`;
    return `${Math.round(v)}円`;
  },
  price: (v: number | null): string => (v == null ? '—' : `¥${Math.round(v).toLocaleString()}`),
  multiple: (v: number | null, digits = 1): string =>
    v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}倍`,
  count: (v: number | null): string =>
    v == null || !Number.isFinite(v) ? '—' : Math.round(v).toLocaleString(),
};

const clamp = (n: number, lo = 0, hi = 100): number => Math.max(lo, Math.min(hi, n));

/** 大きいほど良い指標を 0-100 に正規化 */
const scoreUp = (v: number | null, low: number, high: number): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (high === low) return 50;
  return clamp(((v - low) / (high - low)) * 100);
};

/** 小さいほど良い指標を 0-100 に正規化 */
const scoreDown = (v: number | null, lowGood: number, highBad: number): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  if (highBad === lowGood) return 50;
  return clamp(((highBad - v) / (highBad - lowGood)) * 100);
};

/** 中央レンジが良い (例: RSI=50 が良い) */
const scoreCentered = (v: number | null, ideal: number, half: number): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  const diff = Math.abs(v - ideal);
  return clamp(100 - (diff / half) * 100);
};

/** 平均（null除外） */
const avg = (vals: (number | null)[]): number => {
  const xs = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};

// ───────────────────────── メイン ─────────────────────────

export function buildMandala(args: {
  code: string;
  name: string;
  sector: string;
  chart: YfChart;
  summary: YfSummary;
}): MandalaResult {
  const { code, name, sector, chart, summary } = args;
  const closes = chart.bars.map((b) => b.close);
  const volumes = chart.bars.map((b) => b.volume);
  const price = summary.price ?? closes[closes.length - 1] ?? 0;

  // 各カテゴリを構築
  const growth = buildGrowth(summary);
  const profitability = buildProfitability(summary);
  const valuation = buildValuation(summary);
  const health = buildHealth(summary);
  const momentum = buildMomentum(closes);
  const technical = buildTechnical(closes);
  const volume = buildVolume(volumes, closes);
  const forecast = buildForecast(summary, price);

  const categories: CategoryBlock[] = [growth, profitability, valuation, health, momentum, technical, volume, forecast];
  const totalScore = categories.reduce((a, c) => a + c.score, 0);

  // 中央 3x3 配置 (Lotus Blossom 標準: 中央=銘柄、周囲8=各カテゴリ)
  // 配列順は左上→右上→右下→左下→中央 等任意。ここでは row-major (0..8) で:
  // [growth, profit, valuation,
  //  health, [center stock], momentum,
  //  technical, volume, forecast]
  const centerCells: MandalaCell[] = [
    catSummaryCell(growth),
    catSummaryCell(profitability),
    catSummaryCell(valuation),
    catSummaryCell(health),
    {
      label: name,
      display: fmt.price(price),
      score: null,
      hint: `${code} / ${sector ?? summary.sector ?? '—'}`,
    },
    catSummaryCell(momentum),
    catSummaryCell(technical),
    catSummaryCell(volume),
    catSummaryCell(forecast),
  ];

  // 予測株価: ファンダ50% + テクニカル30% + analyst 20%
  const predictedPrice = computePredictedPrice({ price, summary, technicalScore: technical.score, totalScore });
  const predictedUpsidePct = price > 0 ? ((predictedPrice - price) / price) * 100 : 0;
  const analystUpsidePct = summary.targetMeanPrice && price > 0
    ? ((summary.targetMeanPrice - price) / price) * 100
    : null;

  return {
    ticker: `${code}.T`,
    code,
    name,
    sector: sector ?? summary.sector,
    price,
    targetMeanPrice: summary.targetMeanPrice,
    analystUpsidePct,
    predictedPrice,
    predictedUpsidePct,
    categories,
    centerCells,
    totalScore,
  };
}

function catSummaryCell(c: CategoryBlock): MandalaCell {
  return {
    label: c.name,
    display: `${Math.round(c.score)}点`,
    score: Math.round(c.score),
    hint: `8 指標平均`,
  };
}

// ───────────────────────── カテゴリ別ビルダ ─────────────────────────

function buildGrowth(s: YfSummary): CategoryBlock {
  const cells: MandalaCell[] = [
    metric('売上成長(YoY)', fmt.pct(s.revenueGrowth), s.revenueGrowth, scoreUp(s.revenueGrowth, -0.05, 0.20)),
    metric('利益成長(YoY)', fmt.pct(s.earningsGrowth), s.earningsGrowth, scoreUp(s.earningsGrowth, -0.10, 0.30)),
    metric('粗利率', fmt.pct(s.grossMargins), s.grossMargins, scoreUp(s.grossMargins, 0.05, 0.50)),
    metric('営業利益率', fmt.pct(s.operatingMargins), s.operatingMargins, scoreUp(s.operatingMargins, 0.0, 0.25)),
    centerCell(`成長性`, ''), // index 4
    metric('純利益率', fmt.pct(s.profitMargins), s.profitMargins, scoreUp(s.profitMargins, 0.0, 0.20)),
    metric('売上規模', fmt.yen(s.totalRevenue), s.totalRevenue, scoreUp(s.totalRevenue ? Math.log10(s.totalRevenue) : null, 9, 14)),
    metric('FCF', fmt.yen(s.freeCashflow), s.freeCashflow, s.freeCashflow != null ? scoreUp(s.freeCashflow > 0 ? Math.log10(s.freeCashflow) : null, 8, 13) : null),
    metric('予想EPS', fmt.num(s.forwardEps), s.forwardEps, scoreUp(s.forwardEps, 0, 200)),
  ];
  return finalize('growth', '成長性', cells);
}

function buildProfitability(s: YfSummary): CategoryBlock {
  const cells: MandalaCell[] = [
    metric('ROE', fmt.pct(s.returnOnEquity), s.returnOnEquity, scoreUp(s.returnOnEquity, 0.03, 0.20)),
    metric('ROA', fmt.pct(s.returnOnAssets), s.returnOnAssets, scoreUp(s.returnOnAssets, 0.01, 0.10)),
    metric('営業利益率', fmt.pct(s.operatingMargins), s.operatingMargins, scoreUp(s.operatingMargins, 0.0, 0.25)),
    metric('純利益率', fmt.pct(s.profitMargins), s.profitMargins, scoreUp(s.profitMargins, 0.0, 0.20)),
    centerCell('収益性', ''),
    metric('粗利率', fmt.pct(s.grossMargins), s.grossMargins, scoreUp(s.grossMargins, 0.05, 0.50)),
    metric('営業CF', fmt.yen(s.operatingCashflow), s.operatingCashflow, s.operatingCashflow != null ? scoreUp(s.operatingCashflow > 0 ? Math.log10(s.operatingCashflow) : null, 8, 13) : null),
    metric('FCF', fmt.yen(s.freeCashflow), s.freeCashflow, s.freeCashflow != null ? scoreUp(s.freeCashflow > 0 ? Math.log10(s.freeCashflow) : null, 8, 13) : null),
    metric('実績EPS', fmt.num(s.trailingEps), s.trailingEps, scoreUp(s.trailingEps, 0, 200)),
  ];
  return finalize('profitability', '収益性', cells);
}

function buildValuation(s: YfSummary): CategoryBlock {
  const cells: MandalaCell[] = [
    metric('PER (実績)', fmt.multiple(s.trailingPE), s.trailingPE, scoreDown(s.trailingPE, 8, 30)),
    metric('PER (予想)', fmt.multiple(s.forwardPE), s.forwardPE, scoreDown(s.forwardPE, 6, 25)),
    metric('PBR', fmt.multiple(s.priceToBook), s.priceToBook, scoreDown(s.priceToBook, 0.7, 4)),
    metric('PSR', fmt.multiple(s.priceToSales), s.priceToSales, scoreDown(s.priceToSales, 0.5, 5)),
    centerCell('割安度', ''),
    metric('PEGレシオ', fmt.multiple(s.pegRatio), s.pegRatio, scoreDown(s.pegRatio, 0.5, 3)),
    metric('時価総額', fmt.yen(s.marketCap), s.marketCap, scoreUp(s.marketCap ? Math.log10(s.marketCap) : null, 10, 14)),
    metric('実績EPS', fmt.num(s.trailingEps), s.trailingEps, scoreUp(s.trailingEps, 0, 200)),
    metric('予想EPS', fmt.num(s.forwardEps), s.forwardEps, scoreUp(s.forwardEps, 0, 200)),
  ];
  return finalize('valuation', '割安度', cells);
}

function buildHealth(s: YfSummary): CategoryBlock {
  // debtToEquity は%で来る場合あり。100超は危険水準
  const dte = s.debtToEquity;
  const cells: MandalaCell[] = [
    metric('自己資本比率(代理:1/(1+D/E))', fmt.pct(dte != null ? 1 / (1 + dte / 100) : null), dte != null ? 1 / (1 + dte / 100) : null, scoreUp(dte != null ? 1 / (1 + dte / 100) : null, 0.2, 0.7)),
    metric('D/Eレシオ', fmt.num(dte != null ? dte / 100 : null, 2), dte != null ? dte / 100 : null, scoreDown(dte != null ? dte / 100 : null, 0.2, 2.0)),
    metric('流動比率', fmt.num(s.currentRatio), s.currentRatio, scoreUp(s.currentRatio, 1.0, 3.0)),
    metric('当座比率', fmt.num(s.quickRatio), s.quickRatio, scoreUp(s.quickRatio, 0.7, 2.5)),
    centerCell('財務健全性', ''),
    metric('営業CF', fmt.yen(s.operatingCashflow), s.operatingCashflow, s.operatingCashflow != null && s.operatingCashflow > 0 ? scoreUp(Math.log10(s.operatingCashflow), 8, 13) : 0),
    metric('FCF', fmt.yen(s.freeCashflow), s.freeCashflow, s.freeCashflow != null && s.freeCashflow > 0 ? scoreUp(Math.log10(s.freeCashflow), 8, 13) : 0),
    metric('時価総額', fmt.yen(s.marketCap), s.marketCap, scoreUp(s.marketCap ? Math.log10(s.marketCap) : null, 10, 14)),
    metric('β（市場感応度）', fmt.num(s.beta), s.beta, scoreCentered(s.beta, 1.0, 1.0)),
  ];
  return finalize('health', '財務健全性', cells);
}

function buildMomentum(closes: number[]): CategoryBlock {
  const r1m = periodReturn(closes, 21);
  const r3m = periodReturn(closes, 63);
  const r6m = periodReturn(closes, 126);
  const r1y = periodReturn(closes, 252);
  const r1w = periodReturn(closes, 5);
  const range = range52w(closes);
  const vol30 = volatility(closes, 30);
  const cells: MandalaCell[] = [
    metric('1週リターン', fmt.pctRaw(r1w), r1w, scoreUp(r1w, -5, 5)),
    metric('1ヶ月リターン', fmt.pctRaw(r1m), r1m, scoreUp(r1m, -10, 15)),
    metric('3ヶ月リターン', fmt.pctRaw(r3m), r3m, scoreUp(r3m, -15, 25)),
    metric('6ヶ月リターン', fmt.pctRaw(r6m), r6m, scoreUp(r6m, -20, 35)),
    centerCell('モメンタム', ''),
    metric('1年リターン', fmt.pctRaw(r1y), r1y, scoreUp(r1y, -25, 50)),
    metric('52週レンジ位置', fmt.pctRaw(range != null ? range * 100 : null, 0), range, range != null ? clamp(range * 100) : null),
    metric('年率ボラ', fmt.pctRaw(vol30 != null ? vol30 * 100 : null), vol30, scoreCentered(vol30 != null ? vol30 * 100 : null, 25, 25)),
    metric('現在価格', fmt.price(closes[closes.length - 1]), closes[closes.length - 1], null),
  ];
  return finalize('momentum', 'モメンタム', cells);
}

function buildTechnical(closes: number[]): CategoryBlock {
  const last = closes[closes.length - 1];
  const sma25 = sma(closes, 25);
  const sma75 = sma(closes, 75);
  const sma200 = sma(closes, 200);
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const r = rsi(closes, 14);
  const m = macd(closes);

  // 移動平均との乖離（％）
  const dev = (mv: number | null) => (mv == null ? null : ((last - mv) / mv) * 100);

  const cells: MandalaCell[] = [
    metric('25日線乖離', fmt.pctRaw(dev(sma25)), dev(sma25), scoreCentered(dev(sma25), 0, 8)),
    metric('75日線乖離', fmt.pctRaw(dev(sma75)), dev(sma75), scoreCentered(dev(sma75), 2, 12)),
    metric('200日線乖離', fmt.pctRaw(dev(sma200)), dev(sma200), scoreUp(dev(sma200), -10, 25)),
    metric('RSI(14)', fmt.num(r, 1), r, scoreCentered(r, 50, 30)),
    centerCell('テクニカル', ''),
    metric('MACD', fmt.num(m?.macd ?? null), m?.macd ?? null, m ? (m.macd > 0 ? scoreUp(m.macd, 0, 50) : 0) : null),
    metric('MACDシグナル', fmt.num(m?.signal ?? null), m?.signal ?? null, null),
    metric('MACDヒストグラム', fmt.num(m?.histogram ?? null), m?.histogram ?? null, m ? scoreUp(m.histogram, -20, 20) : null),
    metric('短期EMA - 中期EMA', fmt.num(ema12 != null && ema26 != null ? ema12 - ema26 : null), ema12 != null && ema26 != null ? ema12 - ema26 : null, scoreUp(ema12 != null && ema26 != null ? ema12 - ema26 : null, -100, 100)),
  ];
  return finalize('technical', 'テクニカル', cells);
}

function buildVolume(volumes: number[], closes: number[]): CategoryBlock {
  const v20 = volumeRatio(volumes, 20);
  const v5 = volumeRatio(volumes, 5);
  const lastVol = volumes[volumes.length - 1] ?? null;
  const avg20 = volumes.length >= 20 ? volumes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const turnoverYen = lastVol != null && closes.length ? lastVol * closes[closes.length - 1] : null;
  // OBV 簡易: 直近20日
  let obv = 0;
  if (volumes.length >= 21) {
    for (let i = volumes.length - 20; i < volumes.length; i++) {
      const sign = closes[i] > closes[i - 1] ? 1 : closes[i] < closes[i - 1] ? -1 : 0;
      obv += sign * volumes[i];
    }
  }
  const cells: MandalaCell[] = [
    metric('当日出来高', fmt.count(lastVol), lastVol, null),
    metric('20日平均', fmt.count(avg20), avg20, null),
    metric('20日比率', fmt.num(v20, 2), v20, scoreUp(v20, 0.5, 2.5)),
    metric('5日比率', fmt.num(v5, 2), v5, scoreUp(v5, 0.5, 2.5)),
    centerCell('出来高', ''),
    metric('概算売買代金', fmt.yen(turnoverYen), turnoverYen, scoreUp(turnoverYen ? Math.log10(turnoverYen) : null, 8, 12)),
    metric('OBV(20)', fmt.count(obv), obv, scoreUp(obv, -1e9, 1e9)),
    metric('出来高トレンド', v20 != null ? (v20 > 1.2 ? '増加' : v20 < 0.8 ? '減少' : '横ばい') : '—', v20, v20 != null ? scoreUp(v20, 0.5, 2.0) : null),
    metric('流動性', avg20 != null && avg20 > 1e6 ? '高' : avg20 != null && avg20 > 1e5 ? '中' : '低', avg20, scoreUp(avg20 ? Math.log10(avg20) : null, 4, 7)),
  ];
  return finalize('volume', '出来高', cells);
}

function buildForecast(s: YfSummary, price: number): CategoryBlock {
  const upside = s.targetMeanPrice && price > 0 ? ((s.targetMeanPrice - price) / price) * 100 : null;
  const yieldPct = s.dividendYield != null ? s.dividendYield * 100 : null;
  const cells: MandalaCell[] = [
    metric('目標平均株価', fmt.price(s.targetMeanPrice), s.targetMeanPrice, null),
    metric('目標上値', fmt.price(s.targetHighPrice), s.targetHighPrice, null),
    metric('目標下値', fmt.price(s.targetLowPrice), s.targetLowPrice, null),
    metric('上昇余地', fmt.pctRaw(upside), upside, scoreUp(upside, -10, 30)),
    centerCell('予想・配当', ''),
    metric('推奨平均', fmt.num(s.recommendationMean, 2), s.recommendationMean, scoreDown(s.recommendationMean, 1, 4)), // 1=Strong Buy
    metric('カバーアナリスト数', fmt.count(s.numberOfAnalystOpinions), s.numberOfAnalystOpinions, scoreUp(s.numberOfAnalystOpinions, 0, 25)),
    metric('配当利回り', fmt.pctRaw(yieldPct), yieldPct, scoreUp(yieldPct, 0, 5)),
    metric('配当性向', fmt.pct(s.payoutRatio), s.payoutRatio, scoreCentered(s.payoutRatio, 0.4, 0.4)),
  ];
  return finalize('forecast', '予想・配当', cells);
}

// ───────────────────────── 共通 ─────────────────────────

function metric(label: string, display: string, raw: number | null | undefined, score: number | null): MandalaCell {
  return { label, display, raw: raw ?? null, score };
}

function centerCell(label: string, hint: string): MandalaCell {
  return { label, display: '', score: null, hint };
}

function finalize(key: CategoryKey, name: string, cells: MandalaCell[]): CategoryBlock {
  // 中央 (index 4) を除く 8 セルの平均をカテゴリスコアに
  const periph = cells.filter((_, i) => i !== 4);
  const score = avg(periph.map((c) => c.score));
  // 中央セルを更新
  cells[4] = { ...cells[4], display: `${Math.round(score)}点`, score: Math.round(score), hint: '周囲8指標の平均' };
  return { key, name, score, cells };
}

// ───────────────────────── 予測株価 ─────────────────────────

function computePredictedPrice(args: { price: number; summary: YfSummary; technicalScore: number; totalScore: number }): number {
  const { price, summary, technicalScore, totalScore } = args;
  // 1. アナリスト目標
  const analyst = summary.targetMeanPrice ?? price;
  // 2. ファンダ理論株価: 予想EPS × セクター平均PER相当(15)
  const epsBase = summary.forwardEps ?? summary.trailingEps ?? null;
  const fundamental = epsBase ? epsBase * 15 : price;
  // 3. テクニカル: 現在価格 × (1 + (technicalScore - 50)/200) で ±25%まで補正
  const tech = price * (1 + (technicalScore - 50) / 200);
  // 4. 総合補正: totalScore (0-800) で全体の楽観度を上下
  const optimism = (totalScore - 400) / 800; // -0.5 〜 +0.5
  const blend = analyst * 0.40 + fundamental * 0.35 + tech * 0.25;
  return blend * (1 + optimism * 0.10);
}
