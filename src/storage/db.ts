'use client';

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Settings, Stock, Snapshot } from '@/domain/types';

const DB_NAME = 'mandala-stock';
const DB_VERSION = 1;

interface MandalaDB extends DBSchema {
  stocks: {
    key: string;       // ticker
    value: Stock;
  };
  snapshots: {
    key: string;       // `${ticker}:${date}`
    value: Snapshot;
    indexes: { 'by-ticker': string };
  };
  settings: {
    key: string;       // 'main'
    value: Settings;
  };
}

let _dbPromise: Promise<IDBPDatabase<MandalaDB>> | null = null;

function getDB() {
  if (typeof window === 'undefined') {
    throw new Error('IndexedDB is browser-only');
  }
  if (!_dbPromise) {
    _dbPromise = openDB<MandalaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('stocks')) {
          db.createObjectStore('stocks', { keyPath: 'ticker' });
        }
        if (!db.objectStoreNames.contains('snapshots')) {
          const s = db.createObjectStore('snapshots');
          s.createIndex('by-ticker', 'ticker');
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      },
    });
  }
  return _dbPromise;
}

// ===== Stocks =====
export async function listStocks(): Promise<Stock[]> {
  const db = await getDB();
  return db.getAll('stocks');
}

export async function getStock(ticker: string): Promise<Stock | undefined> {
  const db = await getDB();
  return db.get('stocks', ticker);
}

export async function saveStock(stock: Stock): Promise<void> {
  const db = await getDB();
  await db.put('stocks', stock);
}

export async function deleteStock(ticker: string): Promise<void> {
  const db = await getDB();
  await db.delete('stocks', ticker);
}

// ===== Snapshots =====
/** その日の総合・軸スコアを記録（同日上書き） */
export async function saveSnapshot(snap: Snapshot): Promise<void> {
  const db = await getDB();
  const key = `${snap.ticker}:${snap.date}`;
  await db.put('snapshots', snap, key);
}

export async function listSnapshots(ticker: string): Promise<Snapshot[]> {
  const db = await getDB();
  const idx = db.transaction('snapshots').store.index('by-ticker');
  const out: Snapshot[] = [];
  let cursor = await idx.openCursor(ticker);
  while (cursor) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 任意の Stock から今日の Snapshot を作って保存 */
export async function snapshotStock(stock: Stock): Promise<Snapshot> {
  const date = new Date().toISOString().slice(0, 10);
  const axisScores: Snapshot['axisScores'] = {};
  for (const [axis, m] of Object.entries(stock.subs)) {
    if (m && typeof m.cells[4].score === 'number') axisScores[axis as keyof typeof axisScores] = m.cells[4].score;
  }
  const snap: Snapshot = {
    ticker: stock.ticker,
    date,
    totalScore: typeof stock.root.cells[4].score === 'number' ? stock.root.cells[4].score : 0,
    axisScores,
  };
  await saveSnapshot(snap);
  return snap;
}

// ===== Settings =====
const DEFAULT_SETTINGS: Settings = {
  defaultWeights: [1, 1, 1, 1, 1, 1, 1, 1],
  thresholds: { buy: 80, hold: 60 },
};

export async function getSettings(): Promise<Settings> {
  const db = await getDB();
  return (await db.get('settings', 'main')) ?? DEFAULT_SETTINGS;
}

export async function saveSettings(s: Settings): Promise<void> {
  const db = await getDB();
  await db.put('settings', s, 'main');
}

// ===== Backup =====
export async function exportAll(): Promise<string> {
  const stocks = await listStocks();
  const settings = await getSettings();
  const db = await getDB();
  const snapshots: Snapshot[] = [];
  let cursor = await db.transaction('snapshots').store.openCursor();
  while (cursor) {
    snapshots.push(cursor.value);
    cursor = await cursor.continue();
  }
  return JSON.stringify({
    schema: 'mandala-stock-v1',
    exportedAt: new Date().toISOString(),
    stocks,
    settings,
    snapshots,
  }, null, 2);
}

/**
 * 全銘柄のスナップショットを CSV として出力。
 * Excel / Google Sheets で開けるよう BOM 付き UTF-8。
 * 列: date,ticker,name,total,earnings,finance,valuation,technical,industry,macro,attention,shikiho
 */
export async function exportSnapshotsCSV(): Promise<string> {
  const db = await getDB();
  const stocks = await listStocks();
  const tickerToName = new Map(stocks.map((s) => [s.ticker, s.name]));

  const snapshots: Snapshot[] = [];
  let cursor = await db.transaction('snapshots').store.openCursor();
  while (cursor) {
    snapshots.push(cursor.value);
    cursor = await cursor.continue();
  }
  snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.ticker.localeCompare(b.ticker)));

  const header = ['date', 'ticker', 'name', 'total', 'earnings', 'finance', 'valuation', 'technical', 'industry', 'macro', 'attention', 'shikiho'];
  const escape = (v: string | number | undefined): string => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = snapshots.map((sn) => [
    sn.date,
    sn.ticker,
    tickerToName.get(sn.ticker) ?? '',
    sn.totalScore,
    sn.axisScores.earnings ?? '',
    sn.axisScores.finance ?? '',
    sn.axisScores.valuation ?? '',
    sn.axisScores.technical ?? '',
    sn.axisScores.industry ?? '',
    sn.axisScores.macro ?? '',
    sn.axisScores.attention ?? '',
    sn.axisScores.shikiho ?? '',
  ].map(escape).join(','));
  // BOM (\uFEFF) 付きで返却 → Excel が UTF-8 として正しく開ける
  return '\uFEFF' + [header.join(','), ...rows].join('\n');
}

export async function importAll(json: string): Promise<{ count: number }> {
  const data = JSON.parse(json);
  if (data.schema !== 'mandala-stock-v1') {
    throw new Error('未対応のバックアップ形式です');
  }
  const db = await getDB();
  const tx = db.transaction(['stocks', 'settings', 'snapshots'], 'readwrite');
  for (const s of data.stocks ?? []) {
    await tx.objectStore('stocks').put(s);
  }
  if (data.settings) {
    await tx.objectStore('settings').put(data.settings, 'main');
  }
  for (const sn of data.snapshots ?? []) {
    await tx.objectStore('snapshots').put(sn, `${sn.ticker}:${sn.date}`);
  }
  await tx.done;
  return { count: (data.stocks ?? []).length };
}
