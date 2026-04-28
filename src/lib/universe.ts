/**
 * 銘柄ユニバース
 *
 * src/lib/jp-stocks.json から全上場銘柄をロード。
 * ファイル更新は `npm run update-universe`（JPX 公式から取得）。
 *
 * Yahoo Finance 用ティッカー: `${code}.T`
 */

import jpStocks from './jp-stocks.json';

export interface UniverseStock {
  code: string;
  name: string;
  sector: string;
  market?: string;
}

interface JpStocksFile {
  updatedAt: string;
  source: string;
  count: number;
  stocks: UniverseStock[];
}

const data = jpStocks as JpStocksFile;

/** 全上場銘柄リスト（コード順ソート済み） */
export const UNIVERSE: UniverseStock[] = data.stocks ?? [];

/** 後方互換: 旧コードで NIKKEI225 を import している箇所のため alias 維持 */
export const NIKKEI225: UniverseStock[] = UNIVERSE;

/** ユニバース更新日 */
export const UNIVERSE_UPDATED_AT: string = data.updatedAt ?? '';

/** Yahoo Finance 用ティッカー (例: '7203.T') */
export function toYfTicker(code: string): string {
  return `${code}.T`;
}

/** コードから銘柄を引く */
export function findStock(code: string): UniverseStock | null {
  return UNIVERSE.find((s) => s.code === code) ?? null;
}

/** Yahoo Finance ティッカー → 銘柄 */
export function findStockByTicker(ticker: string): UniverseStock | null {
  const code = ticker.replace(/\.T$/, '');
  return findStock(code);
}
