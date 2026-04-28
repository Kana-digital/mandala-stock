'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Trash2, Sparkles, Wand2, Loader2, Camera } from 'lucide-react';
import { getStock, saveStock, deleteStock, snapshotStock, listSnapshots } from '@/storage/db';
import { recomputeStock, completionCount, judgement, judgementLabel } from '@/domain/scoring';
import { ROOT_AXES } from '@/domain/seed';
import type { Stock, AxisId, Cell, Mandala } from '@/domain/types';
import MandalaGrid from '@/components/MandalaGrid';
import CellEditor from '@/components/CellEditor';
import ScoreBadge from '@/components/ScoreBadge';
import CompletionRing from '@/components/CompletionRing';
import { fetchPatchesForAxis, applyPatches, AXIS_SOURCE } from '@/lib/autofill';
import BadgeShelf from '@/components/BadgeShelf';
import { badgesForStock } from '@/lib/badges';
import SnapshotChart from '@/components/SnapshotChart';
import type { Snapshot } from '@/domain/types';
import SimilarStocks from '@/components/SimilarStocks';
import CompetitorList from '@/components/CompetitorList';
import BacktestPanel from '@/components/BacktestPanel';
import RadarChart from '@/components/RadarChart';
import { findSimilarStocks, type SimilarStock } from '@/lib/similarity';
import { listStocks } from '@/storage/db';

export default function StockDetailPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const router = useRouter();

  const [stock, setStock] = useState<Stock | null>(null);
  const [activeAxis, setActiveAxis] = useState<AxisId | null>(null); // null = root
  const [editing, setEditing] = useState<{ axis: AxisId | 'root'; cell: Cell; index: number } | null>(null);
  const [autofilling, setAutofilling] = useState(false);
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapToast, setSnapToast] = useState(false);
  const [similar, setSimilar] = useState<SimilarStock[]>([]);

  useEffect(() => {
    getStock(ticker).then(async (s) => {
      setStock(s ?? null);
      if (s) {
        const all = await listStocks();
        setSimilar(findSimilarStocks(s, all, 3));
      }
    });
    listSnapshots(ticker).then(setSnapshots);
  }, [ticker]);

  const onSnapshot = async () => {
    if (!stock) return;
    await snapshotStock(stock);
    setSnapshots(await listSnapshots(ticker));
    setSnapToast(true);
    setTimeout(() => setSnapToast(false), 1600);
  };

  if (stock === null) return <div className="p-8 text-slate-400">読み込み中…</div>;

  const currentMandala: Mandala = activeAxis ? stock.subs[activeAxis]! : stock.root;
  const currentTitle = activeAxis
    ? ROOT_AXES.find(a => a.id === activeAxis)?.label ?? ''
    : '総合マンダラ';

  const onCellTap = (index: number, cell: Cell) => {
    // ルート画面で周囲セル（軸）をタップ → 第2階層へドリルダウン
    if (!activeAxis && index !== 4 && cell.value) {
      setActiveAxis(cell.value as AxisId);
      return;
    }
    // 中心セルは編集不可（自動計算）
    if (index === 4) return;
    // それ以外は編集モーダル
    setEditing({ axis: activeAxis ?? 'root', cell, index });
  };

  const onSaveCell = async (updated: Cell) => {
    if (!editing) return;
    const newStock = structuredClone(stock);
    if (editing.axis === 'root') {
      newStock.root.cells[editing.index] = updated;
    } else {
      newStock.subs[editing.axis]!.cells[editing.index] = updated;
    }
    const recomputed = recomputeStock(newStock);
    await saveStock(recomputed);
    setStock(recomputed);
  };

  const onAutofill = async () => {
    if (!activeAxis) return;
    setAutofilling(true);
    setAutofillError(null);
    try {
      const patches = await fetchPatchesForAxis(stock, activeAxis);
      if (patches.length === 0) {
        setAutofillError('この軸は手動入力のみ対応（Phase 2）');
      } else {
        const newStock = structuredClone(stock);
        const updated = applyPatches(newStock.subs[activeAxis]!, patches, AXIS_SOURCE[activeAxis]);
        newStock.subs[activeAxis] = updated;
        const recomputed = recomputeStock(newStock);
        await saveStock(recomputed);
        setStock(recomputed);
      }
    } catch (e) {
      setAutofillError(`取得失敗: ${(e as Error).message}`);
    } finally {
      setAutofilling(false);
    }
  };

  const onDelete = async () => {
    if (!confirm(`${stock.name}（${stock.ticker}）を削除します。よろしいですか？`)) return;
    await deleteStock(stock.ticker);
    router.push('/');
  };

  const totalScore = stock.root.cells[4].score;
  const cc = completionCount(stock);

  return (
    <main className="min-h-dvh">
      {/* ヘッダー */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-md mx-auto flex items-center justify-between px-3 py-3">
          {activeAxis ? (
            <button onClick={() => setActiveAxis(null)} className="flex items-center gap-1 text-slate-300 hover:text-gold p-1">
              <ArrowLeft size={20} />
              <span className="text-sm">戻る</span>
            </button>
          ) : (
            <Link href="/" className="flex items-center gap-1 text-slate-300 hover:text-gold p-1">
              <ArrowLeft size={20} />
              <span className="text-sm">一覧</span>
            </Link>
          )}
          <div className="text-center flex-1 px-2 min-w-0">
            <div className="font-mono text-[10px] text-slate-500">{stock.ticker}</div>
            <div className="font-bold text-white truncate text-sm">{stock.name}</div>
          </div>
          <button onClick={onDelete} className="text-slate-500 hover:text-cinnabar p-1">
            <Trash2 size={18} />
          </button>
        </div>
      </header>

      <div className="max-w-md mx-auto px-3 py-4">
        {/* サマリーカード */}
        <div className="mb-3 bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4 flex items-center gap-3">
          <CompletionRing filled={cc.filled} total={cc.total} size={56} />
          <div className="flex-1">
            <div className="text-[10px] text-slate-500">総合スコア</div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-3xl font-bold tabular-nums text-gold">
                {typeof totalScore === 'number' ? totalScore : '—'}
              </span>
              <ScoreBadge score={totalScore} size="sm" />
            </div>
          </div>
          <Sparkles className="text-gold/60" size={24} />
        </div>

        {/* マンダラ本体 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeAxis ?? 'root'}
            initial={{ opacity: 0, scale: 0.95, rotate: activeAxis ? 5 : -5 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25 }}
          >
            <div className="text-center text-xs text-slate-400 mb-2 font-serif tracking-wider">
              {currentTitle}
            </div>
            <MandalaGrid
              mandala={currentMandala}
              onCellTap={onCellTap}
              centerSubLabel={!activeAxis ? judgementLabel(judgement(totalScore)) : undefined}
            />
            <div className="text-center text-[10px] text-slate-600 mt-2">
              {activeAxis
                ? '各マスをタップでスコア入力。中心は自動計算。'
                : '中央セル以外をタップで第2階層へ展開。'}
            </div>

            {/* 自動入力ボタン（サブマンダラ表示時のみ） */}
            {activeAxis && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <button
                  onClick={onAutofill}
                  disabled={autofilling}
                  className="flex items-center gap-2 px-4 py-2 rounded-full bg-jade/20 ring-1 ring-jade/40 text-jade-light text-sm font-medium hover:bg-jade/30 active:scale-95 transition disabled:opacity-50"
                >
                  {autofilling ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />}
                  {autofilling ? '取得中…' : 'API から自動入力'}
                </button>
                {autofillError && (
                  <div className="text-[10px] text-cinnabar-light bg-cinnabar/10 px-2 py-1 rounded">
                    {autofillError}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* スナップショット & 推移（ルート画面のみ） */}
        {!activeAxis && (
          <div className="mt-6 space-y-4">
            <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4">
              <SnapshotChart snapshots={snapshots} width={320} height={120} />
              <button
                onClick={onSnapshot}
                className="mt-3 w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-gradient-to-r from-jade/30 to-gold/30 ring-1 ring-gold/40 text-white text-sm font-medium active:scale-[0.99] transition"
              >
                <Camera size={16} />
                今日のスコアを保存
              </button>
            </div>
            <BadgeShelf badges={badgesForStock(stock)} title="この銘柄の徽章" />

            <RadarChart stock={stock} />
            <SimilarStocks similar={similar} />
            <CompetitorList ticker={stock.ticker} />
            <BacktestPanel ticker={stock.ticker} snapshots={snapshots} />
          </div>
        )}
      </div>

      {/* スナップショット保存トースト */}
      <AnimatePresence>
        {snapToast && (
          <motion.div
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-jade text-ink-950 px-4 py-2 rounded-full text-xs font-bold shadow-lg z-50"
          >
            ✓ スナップショット保存
          </motion.div>
        )}
      </AnimatePresence>

      {/* セル編集モーダル */}
      <CellEditor
        open={!!editing}
        cell={editing?.cell ?? null}
        onClose={() => setEditing(null)}
        onSave={onSaveCell}
      />
    </main>
  );
}
