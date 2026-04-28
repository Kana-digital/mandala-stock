/**
 * マクロ軸の adapter
 * /api/macro のレスポンスを SUB_CELLS.macro の各セルに割り当てる
 */
import type { CellPatch } from './earnings';

interface MacroSummary {
  latest: number;
  latestDate: string;
  deltaPct: number | null;
}

export interface MacroResponse {
  usdJpy: MacroSummary;
  us10y: MacroSummary;
  vix: MacroSummary;
  sp500: MacroSummary;
  nasdaq: MacroSummary;
  wti: MacroSummary;
}

/**
 * VIX は低いほど良い（恐怖心が低い）→ inverted
 * 金利は文脈で評価が変わるので「中立=50, 急上昇=減点」
 */
function vixScore(latest: number): number {
  if (latest < 15) return 90;
  if (latest < 20) return 70;
  if (latest < 30) return 50;
  if (latest < 40) return 25;
  return 10;
}

function ratesScore(latest: number, deltaPct: number | null): number {
  // 米10年金利: 急上昇は株価ネガティブ
  if (deltaPct == null) return 50;
  if (deltaPct > 10) return 20;
  if (deltaPct > 5) return 35;
  if (deltaPct > -5) return 60;
  return 80;
}

function indexScore(deltaPct: number | null): number {
  if (deltaPct == null) return 50;
  if (deltaPct > 5) return 85;
  if (deltaPct > 0) return 65;
  if (deltaPct > -5) return 40;
  return 20;
}

export function buildMacroPatches(macro: MacroResponse): CellPatch[] {
  const patches: CellPatch[] = [];

  patches.push({
    label: 'USD/JPY',
    value: macro.usdJpy.latest ? macro.usdJpy.latest.toFixed(2) : '—',
    score: indexScore(macro.usdJpy.deltaPct),
    memo: macro.usdJpy.deltaPct != null ? `1ヶ月 ${macro.usdJpy.deltaPct.toFixed(1)}%` : '',
  });

  patches.push({
    label: '長期金利',
    value: macro.us10y.latest ? `${macro.us10y.latest.toFixed(2)}%` : '—',
    score: ratesScore(macro.us10y.latest, macro.us10y.deltaPct),
    memo: 'US 10Y',
  });

  patches.push({
    label: 'S&P500/NASDAQ',
    value: macro.sp500.latest ? macro.sp500.latest.toFixed(0) : '—',
    score: indexScore(macro.sp500.deltaPct),
    memo: macro.sp500.deltaPct != null ? `S&P 1ヶ月 ${macro.sp500.deltaPct.toFixed(1)}%` : '',
  });

  patches.push({
    label: 'VIX',
    value: macro.vix.latest ? macro.vix.latest.toFixed(2) : '—',
    score: vixScore(macro.vix.latest),
  });

  patches.push({
    label: 'コモディティ',
    value: macro.wti.latest ? `WTI ${macro.wti.latest.toFixed(2)}` : '—',
    score: indexScore(macro.wti.deltaPct),
  });

  return patches;
}
