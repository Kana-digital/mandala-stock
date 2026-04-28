/**
 * バッジ／ゲーミフィケーション
 *  - 銘柄ごと、または全体で達成したマイルストーンを判定
 *  - 各バッジは表示用の name / icon-emoji / 取得条件説明を持つ
 */

import type { Stock } from '@/domain/types';
import { completionCount } from '@/domain/scoring';

export interface Badge {
  id: string;
  name: string;
  emoji: string;
  description: string;
  achieved: boolean;
}

/** 1銘柄あたりのバッジ */
export function badgesForStock(stock: Stock): Badge[] {
  const cc = completionCount(stock);
  const total = stock.root.cells[4].score ?? 0;
  const subAxes = Object.keys(stock.subs).length;

  return [
    {
      id: 'starter',
      name: '初手の一手',
      emoji: '🌱',
      description: '1セル以上スコア入力',
      achieved: cc.filled >= 1,
    },
    {
      id: 'half_done',
      name: '半身入魂',
      emoji: '🌗',
      description: '36セル以上入力（半分）',
      achieved: cc.filled >= 36,
    },
    {
      id: 'full_house',
      name: '満マス',
      emoji: '🏯',
      description: '72セル全入力',
      achieved: cc.filled === cc.total,
    },
    {
      id: 'high_score_60',
      name: '中立越え',
      emoji: '⚖️',
      description: '総合60以上',
      achieved: total >= 60,
    },
    {
      id: 'high_score_80',
      name: '黄金',
      emoji: '👑',
      description: '総合80以上＝買いシグナル',
      achieved: total >= 80,
    },
    {
      id: 'all_axes_filled',
      name: '八方位制覇',
      emoji: '🧭',
      description: '8軸すべてに少なくとも1セル入力',
      achieved: subAxes === 8 && Object.values(stock.subs).every((m) =>
        m.cells.some((c, i) => i !== 4 && typeof c.score === 'number')
      ),
    },
  ];
}

/** ポートフォリオ全体のバッジ */
export function badgesForPortfolio(stocks: Stock[]): Badge[] {
  const totalStocks = stocks.length;
  const buyCount = stocks.filter((s) => (s.root.cells[4].score ?? 0) >= 80).length;
  const fullCount = stocks.filter((s) => {
    const cc = completionCount(s);
    return cc.filled === cc.total;
  }).length;

  return [
    {
      id: 'first_stock',
      name: '一銘柄目',
      emoji: '🎯',
      description: '銘柄を1つ以上登録',
      achieved: totalStocks >= 1,
    },
    {
      id: 'five_stocks',
      name: '五銘柄分散',
      emoji: '🖐️',
      description: '銘柄5つ以上',
      achieved: totalStocks >= 5,
    },
    {
      id: 'three_buys',
      name: '黄金トリオ',
      emoji: '💎',
      description: '総合80以上が3銘柄',
      achieved: buyCount >= 3,
    },
    {
      id: 'three_full',
      name: '完成記念',
      emoji: '🏆',
      description: '満マス銘柄が3つ',
      achieved: fullCount >= 3,
    },
  ];
}
