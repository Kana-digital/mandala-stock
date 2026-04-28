import type { AxisId, Cell, Mandala, Stock } from './types';
import { nanoid } from 'nanoid';

/**
 * 第1階層の9マス配置（index 4 が中心の総合スコア、それ以外は8軸）。
 * `id: null` は中心セル（軸を持たない）を表す。
 */
export const ROOT_AXES: { id: AxisId | null; label: string }[] = [
  { id: 'finance',    label: '② 財務' },                       // 0
  { id: 'macro',      label: '⑥ マクロ' },                     // 1
  { id: 'attention',  label: '⑦ 投資家注目度' },               // 2
  { id: 'earnings',   label: '① 業績' },                       // 3
  { id: null,         label: '【総合スコア】' },                // 4 中心
  { id: 'shikiho',    label: '⑧ 四季報定性' },                 // 5
  { id: 'valuation',  label: '③ バリュエーション' },           // 6
  { id: 'technical',  label: '④ テクニカル&チャートパターン' }, // 7
  { id: 'industry',   label: '⑤ 業界・テーマ' },               // 8
];

/** 軸IDから日本語ラベルを引く */
export function axisLabel(id: AxisId): string {
  return ROOT_AXES.find(a => a.id === id)?.label ?? '';
}

/** 第2階層の各軸の8サブセル（中心のスコアラベルは別） */
export const SUB_CELLS: Record<AxisId, string[]> = {
  earnings: [
    '売上高成長率', '営業利益成長率', 'EPS成長率',
    '営業利益率',                 'ROE / ROIC',
    '営業CF / FCF', '通期予想進捗率', '上方修正履歴',
  ],
  finance: [
    '自己資本比率', '有利子負債', '現預金',
    'D/E',                       '流動比率',
    '配当性向', '自社株買い', '増資履歴',
  ],
  valuation: [
    'PER', 'PBR', 'PEG',
    '配当利回り',          'EV/EBITDA',
    'PSR', '過去レンジ比較', '競合比較',
  ],
  technical: [
    '移動平均(25/75/200)', 'トレンド判定', 'RSI / ストキャス',
    '出来高プロファイル',                  '52週高安位置',
    'カップウィズハンドル', 'ブレイクアウト判定', 'ステージ分析(1-4)',
  ],
  industry: [
    'セクター', 'シェア', '競合状況',
    'テーマ性',          '規制環境',
    '参入障壁', '顧客集中度', '海外売上比',
  ],
  macro: [
    '日経/TOPIX', 'グロース指数', 'USD/JPY',
    '長期金利',                  'S&P500/NASDAQ',
    'VIX', 'FOMC見通し', 'コモディティ',
  ],
  attention: [
    '機関投資家保有比率', '外人投資家売買動向', '大量保有報告(EDINET)',
    'アナリストレポート数',                    '空売り残/信用倍率',
    'X(Twitter)言及数', 'Google Trends', 'メディア露出数',
  ],
  shikiho: [
    '会社の特色', '連結事業', '業績見出し',
    '業績コメント',           '材料',
    '株主構成', '役員', '本社所在地',
  ],
};

const now = () => new Date().toISOString();

const emptyCell = (label: string): Cell => ({
  id: nanoid(8),
  label,
  source: 'manual',
});

/** 中心セル（index 4）に「総合スコア」、周囲に軸を配置した第1階層マンダラ */
function createRootMandala(): Mandala {
  const cells = ROOT_AXES.map((a) => {
    if (a.id === null) return emptyCell(a.label);
    return { ...emptyCell(a.label), value: a.id };
  });
  return {
    cells: cells as Mandala['cells'],
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
  };
}

/** 中心セルが小計、周囲が SUB_CELLS の8項目 */
export function createSubMandala(axis: AxisId): Mandala {
  const labels = SUB_CELLS[axis];
  const centerLabel = `【${axisLabel(axis).replace(/^[①-⑧]\s/, '')}スコア】`;
  const cells: Cell[] = [];
  let li = 0;
  for (let i = 0; i < 9; i++) {
    if (i === 4) cells.push(emptyCell(centerLabel));
    else cells.push(emptyCell(labels[li++]));
  }
  return {
    cells: cells as Mandala['cells'],
    weights: [1, 1, 1, 1, 1, 1, 1, 1],
  };
}

export function createNewStock(ticker: string, name: string, sector?: string): Stock {
  const subs: Stock['subs'] = {};
  for (const axis of ROOT_AXES) {
    if (axis.id !== null) subs[axis.id] = createSubMandala(axis.id);
  }
  return {
    ticker,
    name,
    sector,
    root: createRootMandala(),
    subs,
    createdAt: now(),
    updatedAt: now(),
  };
}
