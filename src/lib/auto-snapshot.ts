/**
 * 起動時の自動スナップショット
 *  - 端末が IndexedDB を持つので、サーバ Cron では代替不可
 *  - 「アプリを開いた瞬間に、今日のスナップショットが無ければ自動保存」する
 */

import type { Stock, Snapshot } from '@/domain/types';
import { listSnapshots, snapshotStock } from '@/storage/db';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 渡された全銘柄について、今日の Snapshot が無ければ自動保存。
 * 戻り値: 新しく保存した Snapshot の配列。
 */
export async function autoSnapshotIfNeeded(stocks: Stock[]): Promise<Snapshot[]> {
  const today = todayStr();
  const created: Snapshot[] = [];
  for (const s of stocks) {
    // 総合スコアが未計算なら飛ばす
    if (typeof s.root.cells[4].score !== 'number') continue;
    const existing = await listSnapshots(s.ticker);
    if (existing.some((sn) => sn.date === today)) continue;
    const snap = await snapshotStock(s);
    created.push(snap);
  }
  return created;
}
