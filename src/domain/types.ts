// ====== マンダラ株分析アプリ：ドメイン型定義 ======

export type Score = number; // 0-100
export type Judgement = 'buy' | 'hold' | 'sell';

/** 第1階層の8評価軸 ID */
export type AxisId =
  | 'earnings'        // ① 業績
  | 'finance'         // ② 財務
  | 'valuation'       // ③ バリュエーション
  | 'technical'       // ④ テクニカル&チャートパターン
  | 'industry'        // ⑤ 業界・テーマ
  | 'macro'           // ⑥ マクロ
  | 'attention'       // ⑦ 投資家注目度・センチメント
  | 'shikiho';        // ⑧ 四季報定性

export type Source = 'manual' | 'jquants' | 'edinet' | 'boj' | 'estat' | 'fred' | 'trends' | 'news';

export interface Cell {
  id: string;
  label: string;
  score?: Score;
  value?: string | number;
  memo?: string;
  source?: Source;
  updatedAt?: string; // ISO8601
}

/** 9マスのマンダラ。index 4 が中心（小計または総合）。 */
export interface Mandala {
  cells: [Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell, Cell];
  weights: [number, number, number, number, number, number, number, number]; // 周囲8マスの重み
}

export interface Stock {
  ticker: string;        // 例: "7203"
  name: string;          // 例: "トヨタ自動車"
  sector?: string;
  root: Mandala;                          // 第1階層
  subs: Partial<Record<AxisId, Mandala>>; // 第2階層（最大8枚）
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  ticker: string;
  date: string;          // YYYY-MM-DD
  totalScore: Score;
  axisScores: Partial<Record<AxisId, Score>>;
}

export interface Settings {
  basicAuthHint?: string;
  defaultWeights: [number, number, number, number, number, number, number, number];
  thresholds: {
    buy: number;   // 既定 80
    hold: number;  // 既定 60
  };
}
