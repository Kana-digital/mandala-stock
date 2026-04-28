/**
 * スクリーナー & ターゲット価格計算
 *
 * 1. ハイブリッドスコア
 *    - 定量フィルター（売上成長率・EPS成長率・52週高値位置）
 *    - 通過した銘柄に既存マンダラ的スコア（業績/テクニカル軸を 2倍重み）
 *
 * 2. 3種類のターゲット価格
 *    - テクニカル目標：カップ深さ加算法 / フィボナッチ拡張 / レジスタンス突破
 *    - ファンダ目標：予想EPS × 想定PER
 *    - アナリスト目標：手動入力 or 外部リンク（API は別途）
 */

import type { OHLC, PatternResult } from './patterns';
import {
  detectMaTrend,
  detectStage,
  detectCupWithHandle,
  detectDoubleBottom,
  detectBreakout,
  detect52wPosition,
} from './patterns';

// ===== 入力型 =====

export interface FundamentalSnapshot {
  /** 直近の売上成長率(%) - YoY */
  salesGrowthYoY: number | null;
  /** 直近の営業利益成長率(%) - YoY */
  opGrowthYoY: number | null;
  /** 直近の EPS 成長率(%) - YoY */
  epsGrowthYoY: number | null;
  /** 直近の営業利益率(%) */
  opMargin: number | null;
  /** 通期 EPS 予想（円） */
  forecastEPS: number | null;
  /** 直近 EPS（円, 実績） */
  trailingEPS: number | null;
  /** 業種コード（J-Quants の 33業種） */
  sectorCode?: string;
  /** 業種別の中央値 PER（外部から事前計算して渡す） */
  sectorPerMedian?: number;
}

export interface ScreenInput {
  ticker: string;
  name: string;
  /** 現在値（円） */
  price: number;
  /** 日足 OHLC（古い→新しい、240日以上推奨） */
  daily: OHLC[];
  fundamental: FundamentalSnapshot;
  /** 任意: アナリスト平均目標株価（手動入力） */
  analystTarget?: number;
}

// ===== 結果型 =====

export interface QuantFilter {
  passSalesGrowth: boolean;       // 売上 YoY ≥ 30%
  passEPSGrowth: boolean;         // EPS YoY ≥ 30%
  passNear52wHigh: boolean;       // 52週高値の 95% 以上
  passOpMargin: boolean;          // 営業利益率 ≥ 10%
  /** 0〜4 の通過数 */
  passCount: number;
}

export interface TargetPrices {
  technical: { value: number | null; method: string; upside: number | null };
  fundamental: { value: number | null; method: string; upside: number | null };
  analyst: { value: number | null; method: string; upside: number | null };
}

export interface ScreenResult {
  ticker: string;
  name: string;
  price: number;
  /** ハイブリッド総合スコア 0-100 */
  score: number;
  /** 軸別の内訳 */
  breakdown: {
    growth: number;       // 0-100: 成長軸
    breakout: number;     // 0-100: ブレイクアウト軸
    quality: number;      // 0-100: 利益率・財務質
    valuation: number;    // 0-100: バリュエーション
  };
  filter: QuantFilter;
  patterns: PatternResult[];
  targets: TargetPrices;
  /** 最大の上昇余地 (3つのターゲット中の最大%) */
  bestUpside: number | null;
  notes: string[];
}

// ===== 内部ユーティリティ =====

function clamp(v: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, v));
}

function bandScore(value: number | null, bands: number[]): number {
  if (value == null || !Number.isFinite(value)) return 30;
  // bands は昇順、例: [0, 10, 25, 50] → 30/55/75/95
  const grades = [30, 55, 75, 95];
  for (let i = bands.length - 1; i >= 0; i--) {
    if (value >= bands[i]) return grades[i];
  }
  return 20;
}

// ===== 定量フィルター =====

export function applyQuantFilter(input: ScreenInput): QuantFilter {
  const { fundamental, daily } = input;

  const passSalesGrowth = (fundamental.salesGrowthYoY ?? -Infinity) >= 30;
  const passEPSGrowth = (fundamental.epsGrowthYoY ?? -Infinity) >= 30;
  const passOpMargin = (fundamental.opMargin ?? -Infinity) >= 10;

  // 52週高値位置
  let passNear52wHigh = false;
  if (daily.length >= 240) {
    const window = daily.slice(-252);
    const highs = window.map((d) => d.h ?? -Infinity);
    const max = Math.max(...highs);
    const latest = daily[daily.length - 1].c ?? 0;
    passNear52wHigh = latest >= max * 0.95;
  }

  const passCount = [passSalesGrowth, passEPSGrowth, passOpMargin, passNear52wHigh]
    .filter(Boolean).length;

  return { passSalesGrowth, passEPSGrowth, passNear52wHigh, passOpMargin, passCount };
}

// ===== スコア軸 =====

function growthScore(f: FundamentalSnapshot): number {
  // 売上40% + EPS40% + 営利20%
  const s1 = bandScore(f.salesGrowthYoY, [0, 10, 25, 40]);
  const s2 = bandScore(f.epsGrowthYoY, [0, 10, 30, 50]);
  const s3 = bandScore(f.opGrowthYoY, [0, 10, 30, 50]);
  return clamp(s1 * 0.4 + s2 * 0.4 + s3 * 0.2);
}

function breakoutScore(daily: OHLC[]): { score: number; patterns: PatternResult[] } {
  const patterns = [
    detectMaTrend(daily),
    detectStage(daily),
    detectCupWithHandle(daily),
    detectDoubleBottom(daily),
    detectBreakout(daily),
    detect52wPosition(daily).result,
  ];
  // confidence の重み付き平均
  const weights = [1, 1, 1.5, 1, 2, 1]; // ブレイク&カップを重く
  let sum = 0, wsum = 0;
  patterns.forEach((p, i) => {
    sum += p.confidence * weights[i] * 100;
    wsum += weights[i];
  });
  return { score: clamp(sum / wsum), patterns };
}

function qualityScore(f: FundamentalSnapshot): number {
  return bandScore(f.opMargin, [0, 5, 10, 20]);
}

function valuationScore(price: number, f: FundamentalSnapshot): number {
  const eps = f.forecastEPS ?? f.trailingEPS;
  if (!eps || eps <= 0) return 40;
  const per = price / eps;
  // 業種中央値 PER との比較
  const median = f.sectorPerMedian;
  if (median && median > 0) {
    // PER が中央値の 0.7倍以下 → 95、1.3倍以上 → 30
    const ratio = per / median;
    if (ratio <= 0.7) return 90;
    if (ratio <= 1.0) return 70;
    if (ratio <= 1.3) return 55;
    if (ratio <= 1.7) return 40;
    return 25;
  }
  // 中央値が無い時は絶対値で
  if (per <= 10) return 85;
  if (per <= 20) return 70;
  if (per <= 30) return 55;
  if (per <= 50) return 40;
  return 25;
}

// ===== ターゲット価格 =====

function technicalTarget(daily: OHLC[], price: number, patterns: PatternResult[]): { value: number | null; method: string } {
  if (daily.length < 130) return { value: null, method: 'データ不足' };
  const c = daily.map((d) => d.c).filter((x): x is number => x != null);
  const N = c.length;

  // カップウィズハンドル: ブレイク価格(右リム) + カップ深さ
  const cup = patterns.find((p) => p.name === 'カップウィズハンドル');
  if (cup?.detected) {
    const recentMax = Math.max(...c.slice(N - 25));
    const cupBottom = Math.min(...c.slice(N - 130, N - 25));
    const depth = recentMax - cupBottom;
    return { value: Math.round(recentMax + depth), method: 'カップ深さ加算' };
  }

  // ブレイクアウト: 直近20日高値 + フィボナッチ 1.272
  const breakout = patterns.find((p) => p.name === 'ブレイクアウト');
  if (breakout?.detected) {
    const swingLow = Math.min(...c.slice(N - 60));
    const swingHigh = Math.max(...c.slice(N - 60));
    const range = swingHigh - swingLow;
    return { value: Math.round(swingHigh + range * 0.272), method: 'フィボナッチ1.272拡張' };
  }

  // 52週高値到達
  if (N >= 252) {
    const yearHigh = Math.max(...daily.slice(-252).map((d) => d.h ?? -Infinity));
    if (yearHigh > price) {
      return { value: Math.round(yearHigh), method: '52週高値到達' };
    }
  }

  // フォールバック: 直近高値の 110%
  const recentHigh = Math.max(...c.slice(-60));
  return { value: Math.round(recentHigh * 1.1), method: '直近高値+10%' };
}

function fundamentalTarget(price: number, f: FundamentalSnapshot): { value: number | null; method: string } {
  const eps = f.forecastEPS ?? f.trailingEPS;
  if (!eps || eps <= 0) return { value: null, method: 'EPS不明' };
  const per = f.sectorPerMedian;
  if (per && per > 0) {
    return { value: Math.round(eps * per), method: `予想EPS × 業種中央PER(${per.toFixed(1)})` };
  }
  // 業種中央値が無ければ現状PER維持で予想EPSベース
  const trailingEps = f.trailingEPS;
  if (trailingEps && trailingEps > 0) {
    const currentPer = price / trailingEps;
    return { value: Math.round(eps * currentPer), method: `予想EPS × 現状PER(${currentPer.toFixed(1)})` };
  }
  return { value: null, method: '計算不可' };
}

function buildTargets(input: ScreenInput, patterns: PatternResult[]): TargetPrices {
  const { price, daily, fundamental, analystTarget } = input;
  const tech = technicalTarget(daily, price, patterns);
  const fund = fundamentalTarget(price, fundamental);
  const ana = analystTarget != null ? { value: analystTarget, method: '手動入力' } : { value: null, method: '未登録' };

  const upside = (v: number | null) => v != null && price > 0 ? ((v - price) / price) * 100 : null;
  return {
    technical: { value: tech.value, method: tech.method, upside: upside(tech.value) },
    fundamental: { value: fund.value, method: fund.method, upside: upside(fund.value) },
    analyst: { value: ana.value, method: ana.method, upside: upside(ana.value) },
  };
}

// ===== メイン =====

export function screenStock(input: ScreenInput): ScreenResult {
  const filter = applyQuantFilter(input);
  const breakout = breakoutScore(input.daily);
  const breakdown = {
    growth: growthScore(input.fundamental),
    breakout: breakout.score,
    quality: qualityScore(input.fundamental),
    valuation: valuationScore(input.price, input.fundamental),
  };

  // ハイブリッド総合: 急成長×ブレイク重視
  // 成長 35% / ブレイク 35% / クオリティ 15% / バリュエーション 15%
  const score = clamp(
    breakdown.growth * 0.35 +
      breakdown.breakout * 0.35 +
      breakdown.quality * 0.15 +
      breakdown.valuation * 0.15
  );

  const targets = buildTargets(input, breakout.patterns);
  const upsides = [targets.technical.upside, targets.fundamental.upside, targets.analyst.upside]
    .filter((x): x is number => x != null);
  const bestUpside = upsides.length ? Math.max(...upsides) : null;

  const notes: string[] = [];
  if (filter.passCount === 4) notes.push('✨ 全4フィルター通過');
  else if (filter.passCount >= 2) notes.push(`${filter.passCount}/4 フィルター通過`);
  if (breakout.patterns.find((p) => p.name === 'カップウィズハンドル' && p.detected))
    notes.push('カップウィズハンドル検出');
  if (breakout.patterns.find((p) => p.name === 'ブレイクアウト' && p.detected))
    notes.push('ブレイクアウト検出');

  return {
    ticker: input.ticker,
    name: input.name,
    price: input.price,
    score: Math.round(score),
    breakdown,
    filter,
    patterns: breakout.patterns,
    targets,
    bestUpside,
    notes,
  };
}
