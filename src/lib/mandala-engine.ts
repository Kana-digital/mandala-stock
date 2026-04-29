/**
 * 9x9 曼荼羅チャート計算エンジン
 *
 * 構造:
 *  - 中央 3x3: 銘柄情報セル(中心) + 8 カテゴリ総合点
 *  - 周囲の 8 つの 3x3: 各カテゴリの 9 セル詳細（中央=カテゴリ名+点、周囲8=指標）
 *
 * 全 81 セルにラベル・値・スコア(0-100)・コメントを持たせる。
 * ランキングは「8 カテゴリ総合点の合計（最大 800）」でソート。
 *
 * データソース:
 *  - chart (StooqChart 互換): 株価・出来高 → momentum, technical, volume, attention
 *  - summary (YfSummary 互換): ファンダメンタル → growth, profitability, valuation, health
 *      summary は省略可。null の場合はファンダ系カテゴリは「データなし」として 0 点扱い。
 *
 * 旧 forecast カテゴリは attention カテゴリ（出来高サージ + ボラ + 52週高値ブレイク等）に置換した。
 * 個別アナリスト目標は無料で取得できる正規ソースが存在しないため。
 */

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

// ───────── 入力型（Yahoo / Stooq 共通の最小契約） ─────────

export interface ChartBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MandalaChart {
  ticker: string;
  bars: ChartBar[];
}

/**
 * ファンダメンタルサマリー。
 * 旧 yahoo.ts の YfSummary と同一フィールド構成にしているので互換が効く。
 * 取得元は J-Quants statements 等から合成して渡す（任意・null 可）。
 */
export interface MandalaSummary {
  price: number | null;
  currency: string | null;
  longName: string | null;
  sector: string | null;
  industry: string | null;

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

  dividendYield: number | null;
  payoutRatio: number | null;
  averageVolume: number | null;
  averageVolume10days: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;

  epsForecastCurrentYear: number | null;
}

// ───────── 出力型 ─────────

export type CategoryKey =
  | 'growth'
  | 'profitability'
  | 'valuation'
  | 'health'
  | 'momentum'
  | 'technical'
  | 'volume'
  | 'attention';

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
  /** アナリストコンセンサスtarget (廃止 — 互換のため保持、常に null) */
  targetMeanPrice: number | null;
  /** 上昇率% (target / price - 1) * 100 (廃止 — 互換のため保持、常に null) */
  analystUpsidePct: number | null;
  /** 計算ベースの予測株価（テクニカル + 注目度 + (任意で)ファンダのハイブリッド） */
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
  ratio: (v: number | null, digits = 2): string =>
    v == null || !Number.isFinite(v) ? '—' : `×${v.toFixed(digits)}`,
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
  chart: MandalaChart;
  /** 任意。J-Quants 等から合成したファンダ。未指定ならファンダ系カテゴリは 0 点扱い */
  summary?: MandalaSummary | null;
}): MandalaResult {
  const { code, name, sector, chart } = args;
  const summary = args.summary ?? null;
  const closes = chart.bars.map((b) => b.close);
  const highs = chart.bars.map((b) => b.high);
  const lows = chart.bars.map((b) => b.low);
  const volumes = chart.bars.map((b) => b.volume);
  const price = summary?.price ?? closes[closes.length - 1] ?? 0;

  // 各カテゴリを構築
  const growth = buildGrowth(summary);
  const profitability = buildProfitability(summary);
  const valuation = buildValuation(summary);
  const health = buildHealth(summary);
  const momentum = buildMomentum(closes);
  const technical = buildTechnical(closes);
  const volume = buildVolume(volumes, closes);
  const attention = buildAttention(closes, volumes, highs, lows);

  const categories: CategoryBlock[] = [growth, profitability, valuation, health, momentum, technical, volume, attention];
  const totalScore = categories.reduce((a, c) => a + c.score, 0);

  // 中央 3x3 配置 (Lotus Blossom 標準: 中央=銘柄、周囲8=各カテゴリ)
  // [growth, profit, valuation,
  //  health, [center stock], momentum,
  //  technical, volume, attention]
  const centerCells: MandalaCell[] = [
    catSummaryCell(growth),
    catSummaryCell(profitability),
    catSummaryCell(valuation),
    catSummaryCell(health),
    {
      label: name,
      display: fmt.price(price),
      score: null,
      hint: `${code} / ${sector ?? summary?.sector ?? '—'}`,
    },
    catSummaryCell(momentum),
    catSummaryCell(technical),
    catSummaryCell(volume),
    catSummaryCell(attention),
  ];

  // 予測株価
  const predictedPrice = computePredictedPrice({
    price,
    summary,
    technicalScore: technical.score,
    attentionScore: attention.score,
    totalScore,
  });
  const predictedUpsidePct = price > 0 ? ((predictedPrice - price) / price) * 100 : 0;

  return {
    ticker: `${code}.T`,
    code,
    name,
    sector: sector ?? summary?.sector ?? null,
    price,
    targetMeanPrice: null,
    analystUpsidePct: null,
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

// ───────────────────────── ファンダ系カテゴリ（summary 任意） ─────────────────────────

/** summary が null のときに使うフォールバックメトリック */
function blank(label: string, hint = 'データ未取得'): MandalaCell {
  return { label, display: '—', score: 0, raw: null, hint };
}

function buildGrowth(s: MandalaSummary | null): CategoryBlock {
  if (!s) {
    const cells: MandalaCell[] = [
      blank('売上成長(YoY)'),
      blank('利益成長(YoY)'),
      blank('粗利率'),
      blank('営業利益率'),
      centerCell('成長性', ''),
      blank('純利益率'),
      blank('売上規模'),
      blank('FCF'),
      blank('予想EPS'),
    ];
    return finalize('growth', '成長性', cells);
  }
  const cells: MandalaCell[] = [
    metric('売上成長(YoY)', fmt.pct(s.revenueGrowth), s.revenueGrowth, scoreUp(s.revenueGrowth, -0.05, 0.20)),
    metric('利益成長(YoY)', fmt.pct(s.earningsGrowth), s.earningsGrowth, scoreUp(s.earningsGrowth, -0.10, 0.30)),
    metric('粗利率', fmt.pct(s.grossMargins), s.grossMargins, scoreUp(s.grossMargins, 0.05, 0.50)),
    metric('営業利益率', fmt.pct(s.operatingMargins), s.operatingMargins, scoreUp(s.operatingMargins, 0.0, 0.25)),
    centerCell('成長性', ''),
    metric('純利益率', fmt.pct(s.profitMargins), s.profitMargins, scoreUp(s.profitMargins, 0.0, 0.20)),
    metric('売上規模', fmt.yen(s.totalRevenue), s.totalRevenue, scoreUp(s.totalRevenue ? Math.log10(s.totalRevenue) : null, 9, 14)),
    metric('FCF', fmt.yen(s.freeCashflow), s.freeCashflow, s.freeCashflow != null ? scoreUp(s.freeCashflow > 0 ? Math.log10(s.freeCashflow) : null, 8, 13) : null),
    metric('予想EPS', fmt.num(s.forwardEps), s.forwardEps, scoreUp(s.forwardEps, 0, 200)),
  ];
  return finalize('growth', '成長性', cells);
}

function buildProfitability(s: MandalaSummary | null): CategoryBlock {
  if (!s) {
    const cells: MandalaCell[] = [
      blank('ROE'),
      blank('ROA'),
      blank('営業利益率'),
      blank('純利益率'),
      centerCell('収益性', ''),
      blank('粗利率'),
      blank('営業CF'),
      blank('FCF'),
      blank('実績EPS'),
    ];
    return finalize('profitability', '収益性', cells);
  }
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

function buildValuation(s: MandalaSummary | null): CategoryBlock {
  if (!s) {
    const cells: MandalaCell[] = [
      blank('PER (実績)'),
      blank('PER (予想)'),
      blank('PBR'),
      blank('PSR'),
      centerCell('割安度', ''),
      blank('PEGレシオ'),
      blank('時価総額'),
      blank('実績EPS'),
      blank('予想EPS'),
    ];
    return finalize('valuation', '割安度', cells);
  }
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

function buildHealth(s: MandalaSummary | null): CategoryBlock {
  if (!s) {
    const cells: MandalaCell[] = [
      blank('自己資本比率(代理:1/(1+D/E))'),
      blank('D/Eレシオ'),
      blank('流動比率'),
      blank('当座比率'),
      centerCell('財務健全性', ''),
      blank('営業CF'),
      blank('FCF'),
      blank('時価総額'),
      blank('β（市場感応度）'),
    ];
    return finalize('health', '財務健全性', cells);
  }
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

// ───────────────────────── チャート系カテゴリ ─────────────────────────

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

/**
 * 注目度カテゴリ — チャートのみから「市場の関心が急上昇しているか」を測る。
 * 旧 forecast カテゴリ（アナリスト目標）の代替。
 *
 * 8 指標:
 *  1. 出来高サージ (5日平均 / 100日平均)
 *  2. 出来高 z-score (直近 vs 60日平均/SD)
 *  3. 52週高値ブレイク距離 (近いほど高得点)
 *  4. 52週レンジ位置
 *  5. ボラ急上昇率 (10日ボラ / 60日ボラ)
 *  6. 連続陽線/陰線 streak
 *  7. ATR/価格 (相対値動き)
 *  8. 1週 + 1ヶ月の合成モメンタム
 */
function buildAttention(closes: number[], volumes: number[], highs: number[], lows: number[]): CategoryBlock {
  const n = closes.length;

  // 1. 出来高サージ: 5日平均 / 100日平均（または 20日にフォールバック）
  const surge = volumeSurge(volumes, 5, n >= 100 ? 100 : 20);

  // 2. 出来高 z-score: 直近1日が60日平均から何σ離れているか
  const zScore = volumeZScore(volumes, 60);

  // 3. 52週高値からの距離 (%) — 高値に近いほど良い
  const distFromHigh = distanceFromHigh(closes, 252);

  // 4. 52週レンジ位置
  const range = range52w(closes);

  // 5. ボラ急上昇率
  const v10 = volatility(closes, 10);
  const v60 = volatility(closes, 60);
  const volRatio = v10 != null && v60 != null && v60 > 0 ? v10 / v60 : null;

  // 6. 連続陽線 streak (直近 30 日内、最大連続上昇日数)
  const streak = upStreak(closes);

  // 7. ATR/価格 (14日 True Range の平均 / 直近終値)
  const atrPct = atrPercent(highs, lows, closes, 14);

  // 8. 短期合成モメンタム (1w + 1m / 2)
  const r1w = periodReturn(closes, 5);
  const r1m = periodReturn(closes, 21);
  const compMom =
    r1w != null && r1m != null ? (r1w + r1m) / 2 : (r1w ?? r1m ?? null);

  const cells: MandalaCell[] = [
    metric('出来高サージ', fmt.ratio(surge), surge, scoreUp(surge, 0.7, 3.0)),
    metric('出来高Zスコア', fmt.num(zScore, 2), zScore, scoreUp(zScore, -1, 4)),
    metric('52週高値距離', fmt.pctRaw(distFromHigh != null ? -distFromHigh * 100 : null), distFromHigh, scoreUp(distFromHigh != null ? -distFromHigh : null, -0.30, 0)),
    metric('52週レンジ位置', fmt.pctRaw(range != null ? range * 100 : null, 0), range, range != null ? clamp(range * 100) : null),
    centerCell('注目度', '出来高サージ + 高値接近 + ボラ急騰'),
    metric('ボラ急騰率', fmt.ratio(volRatio), volRatio, scoreUp(volRatio, 0.7, 2.5)),
    metric('連続上昇日数', streak != null ? `${streak}日` : '—', streak, scoreUp(streak, 0, 7)),
    metric('ATR/価格', fmt.pctRaw(atrPct != null ? atrPct * 100 : null), atrPct, scoreUp(atrPct, 0.005, 0.05)),
    metric('短期合成モメンタム', fmt.pctRaw(compMom), compMom, scoreUp(compMom, -8, 12)),
  ];
  return finalize('attention', '注目度', cells);
}

// ───────────────────────── attention 用ヘルパ ─────────────────────────

function volumeSurge(volumes: number[], shortPeriod: number, longPeriod: number): number | null {
  if (volumes.length < longPeriod + 1) return null;
  const tail = volumes.slice(-shortPeriod);
  const long = volumes.slice(-longPeriod);
  const tAvg = tail.reduce((a, b) => a + b, 0) / tail.length;
  const lAvg = long.reduce((a, b) => a + b, 0) / long.length;
  if (lAvg === 0) return null;
  return tAvg / lAvg;
}

function volumeZScore(volumes: number[], period: number): number | null {
  if (volumes.length < period + 1) return null;
  const slice = volumes.slice(-(period + 1), -1); // 直近 1 日を除外
  if (slice.length < period) return null;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const v = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
  const sd = Math.sqrt(v);
  if (sd === 0) return null;
  const last = volumes[volumes.length - 1];
  return (last - mean) / sd;
}

/** 52週高値からどれだけ下にいるか（0 = 高値、+0.30 = 30%下、負ならブレイク） */
function distanceFromHigh(closes: number[], period: number): number | null {
  if (closes.length === 0) return null;
  const slice = closes.slice(-Math.min(period, closes.length));
  const hi = Math.max(...slice);
  if (hi === 0) return null;
  return (hi - closes[closes.length - 1]) / hi;
}

function upStreak(closes: number[]): number | null {
  if (closes.length < 2) return null;
  let streak = 0;
  for (let i = closes.length - 1; i > 0 && i > closes.length - 30; i--) {
    if (closes[i] > closes[i - 1]) streak++;
    else break;
  }
  return streak;
}

function atrPercent(highs: number[], lows: number[], closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = closes.length - period; i < closes.length; i++) {
    const h = highs[i];
    const l = lows[i];
    const pc = closes[i - 1];
    if (h == null || l == null || pc == null) continue;
    const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  const last = closes[closes.length - 1];
  if (last <= 0) return null;
  return atr / last;
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

function computePredictedPrice(args: {
  price: number;
  summary: MandalaSummary | null;
  technicalScore: number;
  attentionScore: number;
  totalScore: number;
}): number {
  const { price, summary, technicalScore, attentionScore, totalScore } = args;
  if (price <= 0) return 0;

  // 1. ファンダ理論株価: 予想EPS × 15 (summary なしならスキップ)
  const epsBase = summary?.forwardEps ?? summary?.trailingEps ?? null;
  const fundamental = epsBase ? epsBase * 15 : null;

  // 2. テクニカル: 現在価格 × (1 + (technicalScore - 50)/200) で ±25%まで補正
  const tech = price * (1 + (technicalScore - 50) / 200);

  // 3. 注目度補正: attention が高い銘柄は短期上振れを織り込む（最大 +12%）
  const att = price * (1 + (attentionScore - 50) / 250);

  // 4. ブレンド
  let blend: number;
  if (fundamental != null) {
    blend = fundamental * 0.40 + tech * 0.35 + att * 0.25;
  } else {
    // ファンダ無しならテクニカル + 注目度 + 現在価格を均等
    blend = price * 0.40 + tech * 0.35 + att * 0.25;
  }

  // 5. 総合楽観度補正 (totalScore 0-800 → ±10%)
  const optimism = (totalScore - 400) / 800;
  return blend * (1 + optimism * 0.10);
}
