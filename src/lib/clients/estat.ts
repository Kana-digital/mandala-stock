/**
 * e-Stat API (政府統計の総合窓口) クライアント
 * https://www.e-stat.go.jp/api/
 *
 * 環境変数: ESTAT_APP_ID
 *
 * 使い方:
 *  1. 統計表 ID (statsDataId) を Web で検索
 *  2. fetchStatsData(statsDataId) で取得
 */

const BASE = 'https://api.e-stat.go.jp/rest/3.0/app/json';

interface EstatValue {
  '@cat01'?: string;
  '@time'?: string;
  '@unit'?: string;
  $: string; // value
}

export interface EstatRow {
  time: string;
  category?: string;
  unit?: string;
  value: number;
}

export async function fetchStatsData(statsDataId: string, opts?: { limit?: number }): Promise<EstatRow[]> {
  const appId = process.env.ESTAT_APP_ID;
  if (!appId) throw new Error('ESTAT_APP_ID is not set');

  const params = new URLSearchParams({
    appId,
    statsDataId,
    limit: String(opts?.limit ?? 100),
  });
  const res = await fetch(`${BASE}/getStatsData?${params}`);
  if (!res.ok) throw new Error(`e-Stat ${statsDataId} failed: ${res.status}`);
  const json = (await res.json()) as {
    GET_STATS_DATA?: { STATISTICAL_DATA?: { DATA_INF?: { VALUE?: EstatValue[] } } };
  };
  const values = json.GET_STATS_DATA?.STATISTICAL_DATA?.DATA_INF?.VALUE ?? [];
  return values
    .map((v) => ({
      time: v['@time'] ?? '',
      category: v['@cat01'],
      unit: v['@unit'],
      value: Number(v.$),
    }))
    .filter((r) => Number.isFinite(r.value));
}
