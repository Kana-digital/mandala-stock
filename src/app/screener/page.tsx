'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Sparkles, Loader2, Target, TrendingUp, Plus,
  ExternalLink, Filter, X, Crown, Trophy, Medal, Flame,
} from 'lucide-react';
import type { ScreenResult } from '@/lib/screening';
import { saveStock, getStock } from '@/storage/db';
import { createNewStock } from '@/domain/seed';
import AnimatedNumber from '@/components/AnimatedNumber';
import Confetti from '@/components/Confetti';

interface RowState {
  ticker: string;
  name?: string;
  analyst?: number;
  status: 'idle' | 'loading' | 'done' | 'error';
  result?: ScreenResult;
  error?: string;
}

/** "7203 トヨタ自動車" のような行をパース。スペース・タブ・カンマ区切り対応 */
function parseTickerLine(line: string): { ticker: string; name?: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4,5})[\s,\t　]*(.*)$/);
  if (!m) return null;
  return { ticker: m[1], name: m[2] || undefined };
}

async function runScreen(row: RowState): Promise<ScreenResult> {
  const params = new URLSearchParams({ ticker: row.ticker });
  if (row.name) params.set('name', row.name);
  if (row.analyst != null) params.set('analyst', String(row.analyst));
  const res = await fetch(`/api/screen?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** 並列実行の同時数 */
const CONCURRENCY = 3;

async function runWithLimit<T>(items: T[], fn: (t: T, i: number) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) {
        const my = i++;
        await fn(items[my], my);
      }
    })
  );
}

export default function ScreenerPage() {
  const [paste, setPaste] = useState('');
  const [rows, setRows] = useState<RowState[]>([]);
  const [running, setRunning] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [minUpside, setMinUpside] = useState(0);
  const [sortKey, setSortKey] = useState<'score' | 'upside'>('score');

  const onParse = () => {
    const lines = paste.split('\n').map(parseTickerLine).filter((x): x is { ticker: string; name?: string } => x != null);
    // 重複排除
    const seen = new Set<string>();
    const unique = lines.filter((l) => {
      if (seen.has(l.ticker)) return false;
      seen.add(l.ticker);
      return true;
    });
    setRows(unique.map((l) => ({ ticker: l.ticker, name: l.name, status: 'idle' })));
    setPaste('');
  };

  const onRun = async () => {
    if (rows.length === 0) return;
    setRunning(true);
    setRows((rs) => rs.map((r) => ({ ...r, status: 'loading' as const })));

    const next = [...rows];
    const updateRow = (idx: number, patch: Partial<RowState>) => {
      next[idx] = { ...next[idx], ...patch };
      setRows([...next]);
    };

    await runWithLimit(rows, async (row, idx) => {
      try {
        const result = await runScreen(row);
        updateRow(idx, { status: 'done', result });
      } catch (e) {
        updateRow(idx, { status: 'error', error: (e as Error).message });
      }
    });
    setRunning(false);
  };

  const onClear = () => {
    setRows([]);
    setPaste('');
  };

  const onRemove = (ticker: string) => {
    setRows((rs) => rs.filter((r) => r.ticker !== ticker));
  };

  const onSetAnalyst = async (ticker: string, value: number) => {
    setRows((rs) =>
      rs.map((r) =>
        r.ticker === ticker
          ? { ...r, analyst: value, status: 'loading' as const }
          : r
      )
    );
    const target = rows.find((r) => r.ticker === ticker);
    if (!target) return;
    try {
      const result = await runScreen({ ...target, analyst: value });
      setRows((rs) =>
        rs.map((r) =>
          r.ticker === ticker ? { ...r, status: 'done' as const, result, analyst: value } : r
        )
      );
    } catch (e) {
      setRows((rs) =>
        rs.map((r) =>
          r.ticker === ticker ? { ...r, status: 'error' as const, error: (e as Error).message } : r
        )
      );
    }
  };

  const addToWatchlist = async (row: RowState) => {
    if (!row.result) return;
    const existing = await getStock(row.ticker);
    if (existing) {
      alert(`${row.ticker} は既にウォッチリストに登録済みです`);
      return;
    }
    const stock = createNewStock(row.ticker, row.result.name);
    await saveStock(stock);
    alert(`${row.ticker} ${row.result.name} をウォッチリストに追加しました`);
  };

  const sorted = useMemo(() => {
    const done = rows.filter((r) => r.status === 'done' && r.result);
    const filtered = done.filter((r) => {
      const sc = r.result!.score;
      const up = r.result!.bestUpside ?? -Infinity;
      return sc >= minScore && up >= minUpside;
    });
    return filtered.sort((a, b) => {
      if (sortKey === 'score') return b.result!.score - a.result!.score;
      return (b.result!.bestUpside ?? -Infinity) - (a.result!.bestUpside ?? -Infinity);
    });
  }, [rows, minScore, minUpside, sortKey]);

  const doneCount = rows.filter((r) => r.status === 'done').length;
  const errCount = rows.filter((r) => r.status === 'error').length;

  // 80点以上の銘柄が現れたらコンフェッティ発射
  const highScoreCount = rows.filter((r) => r.status === 'done' && (r.result?.score ?? 0) >= 80).length;
  const [confettiTrigger, setConfettiTrigger] = useState(0);
  const [prevHighScore, setPrevHighScore] = useState(0);
  useEffect(() => {
    if (!running && highScoreCount > prevHighScore) {
      setConfettiTrigger((n) => n + 1);
    }
    setPrevHighScore(highScoreCount);
  }, [running, highScoreCount, prevHighScore]);

  return (
    <main className="min-h-dvh relative">
      <div aria-hidden className="fixed inset-0 -z-10 aurora opacity-50" />
      <Confetti trigger={confettiTrigger} count={70} />

      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-2xl mx-auto flex items-center px-4 py-3">
          <Link href="/" className="flex items-center gap-1 text-slate-300 hover:text-gold p-1">
            <ArrowLeft size={20} />
            <span className="text-sm">戻る</span>
          </Link>
          <h1 className="flex-1 text-center font-serif flex items-center justify-center gap-1.5 text-lg">
            <Target size={18} className="text-gold-light animate-sparkle" />
            <span className="text-gradient-gold">スクリーナー</span>
          </h1>
          <span className="w-10" />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4 pb-20">
        {/* 入力エリア */}
        <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
          <h2 className="font-bold text-gold mb-2 text-sm">候補銘柄を貼り付け</h2>
          <p className="text-[11px] text-slate-400 mb-2 leading-relaxed">
            証券会社のスクリーナーで絞った候補のティッカー（4桁数字）を改行区切りで貼り付け。
            「<span className="text-gold">7203 トヨタ自動車</span>」のように銘柄名も書けます。
          </p>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={5}
            placeholder={`7203 トヨタ自動車\n9984 ソフトバンクグループ\n6758 ソニーグループ\n...`}
            className="w-full bg-ink-800 ring-1 ring-ink-700 focus:ring-gold rounded-xl px-3 py-2 text-white text-sm font-mono"
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={onParse}
              disabled={!paste.trim()}
              className="flex-1 py-2 rounded-xl bg-ink-800 ring-1 ring-jade/40 text-jade-light text-sm font-medium disabled:opacity-40"
            >
              候補に追加
            </button>
            {rows.length > 0 && (
              <button
                onClick={onClear}
                className="px-4 py-2 rounded-xl bg-ink-800 ring-1 ring-ink-700 text-slate-400 text-sm"
              >
                クリア
              </button>
            )}
          </div>
        </section>

        {/* 候補一覧 */}
        {rows.length > 0 && (
          <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-gold text-sm">
                候補 {rows.length}件
                {doneCount > 0 && <span className="text-xs text-jade-light ml-2">/ 完了 {doneCount}</span>}
                {errCount > 0 && <span className="text-xs text-cinnabar-light ml-2">/ エラー {errCount}</span>}
              </h2>
              <button
                onClick={onRun}
                disabled={running || rows.length === 0}
                className="lift shine relative overflow-hidden flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-gradient-to-r from-gold via-gold-light to-gold-dark text-ink-950 font-bold text-sm disabled:opacity-40 animate-glow-pulse"
              >
                {running ? <Loader2 size={14} className="animate-spin" /> : <Flame size={14} />}
                {running ? '解析中…' : 'スクリーニング実行'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {rows.map((r) => (
                <span
                  key={r.ticker}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] ring-1 ${
                    r.status === 'done'
                      ? 'bg-jade/10 ring-jade/40 text-jade-light'
                      : r.status === 'error'
                      ? 'bg-cinnabar/10 ring-cinnabar/40 text-cinnabar-light'
                      : r.status === 'loading'
                      ? 'bg-gold/10 ring-gold/40 text-gold'
                      : 'bg-ink-800 ring-ink-700 text-slate-400'
                  }`}
                >
                  {r.status === 'loading' && <Loader2 size={10} className="animate-spin" />}
                  <span className="font-mono">{r.ticker}</span>
                  {r.name && <span>· {r.name}</span>}
                  {!running && (
                    <button
                      onClick={() => onRemove(r.ticker)}
                      className="ml-0.5 opacity-60 hover:opacity-100"
                    >
                      <X size={10} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* フィルター */}
        {doneCount > 0 && (
          <section className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-4">
            <h2 className="font-bold text-gold text-sm flex items-center gap-1.5 mb-3">
              <Filter size={14} /> ランキングフィルター
            </h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-slate-400">最低スコア</span>
                <input
                  type="number" min={0} max={100} step={5}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value) || 0)}
                  className="bg-ink-800 ring-1 ring-ink-700 rounded-lg px-2 py-1 text-white tabular-nums"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-slate-400">最低上昇余地 (%)</span>
                <input
                  type="number" min={-50} max={500} step={5}
                  value={minUpside}
                  onChange={(e) => setMinUpside(Number(e.target.value) || 0)}
                  className="bg-ink-800 ring-1 ring-ink-700 rounded-lg px-2 py-1 text-white tabular-nums"
                />
              </label>
              <label className="flex flex-col gap-1 col-span-2">
                <span className="text-slate-400">並び替え</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSortKey('score')}
                    className={`flex-1 py-1.5 rounded-lg ring-1 text-xs ${
                      sortKey === 'score' ? 'bg-gold/20 ring-gold text-gold' : 'bg-ink-800 ring-ink-700 text-slate-400'
                    }`}
                  >
                    スコア順
                  </button>
                  <button
                    onClick={() => setSortKey('upside')}
                    className={`flex-1 py-1.5 rounded-lg ring-1 text-xs ${
                      sortKey === 'upside' ? 'bg-gold/20 ring-gold text-gold' : 'bg-ink-800 ring-ink-700 text-slate-400'
                    }`}
                  >
                    上昇余地順
                  </button>
                </div>
              </label>
            </div>
            <p className="text-[10px] text-slate-500 mt-2">
              表示中: {sorted.length} / {doneCount} 件
            </p>
          </section>
        )}

        {/* ランキング結果 */}
        <AnimatePresence>
          {sorted.map((row, idx) => (
            <ResultCard
              key={row.ticker}
              row={row}
              rank={idx + 1}
              onAddWatchlist={() => addToWatchlist(row)}
              onSetAnalyst={(v) => onSetAnalyst(row.ticker, v)}
            />
          ))}
        </AnimatePresence>

        {/* エラー一覧 */}
        {errCount > 0 && (
          <section className="bg-cinnabar/10 ring-1 ring-cinnabar/30 rounded-2xl p-4">
            <h3 className="font-bold text-cinnabar-light text-sm mb-2">取得エラー</h3>
            <ul className="text-[11px] text-slate-300 space-y-1">
              {rows.filter((r) => r.status === 'error').map((r) => (
                <li key={r.ticker}>
                  <span className="font-mono">{r.ticker}</span> {r.name && `· ${r.name}`} — {r.error}
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-slate-500 mt-2">
              ※ J-Quants の無料プラン制約・銘柄コード誤り・上場廃止などが原因の可能性。
            </p>
          </section>
        )}

        {rows.length === 0 && (
          <div className="text-center py-12 relative">
            <div className="relative inline-block">
              <Trophy size={56} className="mx-auto text-gold/60 mb-3 animate-float" />
              <Sparkles size={20} className="absolute -top-1 -right-3 text-gold-light animate-sparkle" />
            </div>
            <h2 className="text-xl font-bold text-gradient-gold mb-1">勝てる銘柄を探そう</h2>
            <p className="text-slate-300 text-sm px-6">
              候補ティッカーを貼り付けるだけ。<br />
              成長率・ブレイクアウト・3種ターゲット価格を一気に分析。
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

// ===== サブコンポーネント =====

function rankMeta(rank: number) {
  if (rank === 1) return { Icon: Crown, label: 'CHAMPION', cls: 'rank-gold text-ink-950', ring: 'ring-gold-light shadow-2xl shadow-gold/40' };
  if (rank === 2) return { Icon: Trophy, label: 'RUNNER UP', cls: 'rank-silver text-ink-950', ring: 'ring-slate-300 shadow-xl shadow-slate-400/30' };
  if (rank === 3) return { Icon: Medal,  label: 'BRONZE',   cls: 'rank-bronze text-ink-950', ring: 'ring-amber-700 shadow-xl shadow-amber-700/30' };
  return null;
}

function ResultCard({
  row, rank, onAddWatchlist, onSetAnalyst,
}: {
  row: RowState;
  rank: number;
  onAddWatchlist: () => void;
  onSetAnalyst: (v: number) => void;
}) {
  const r = row.result!;
  const isChampion = rank === 1;
  const isPodium = rank <= 3;
  const meta = rankMeta(rank);
  const scoreClass =
    r.score >= 80 ? 'from-gold via-gold-light to-gold-dark text-ink-950'
    : r.score >= 60 ? 'from-jade to-jade-dark text-ink-950'
    : 'from-ink-700 to-ink-800 text-slate-300';

  const upColor = (u: number | null) =>
    u == null ? 'text-slate-500' : u >= 30 ? 'text-cinnabar-light' : u >= 10 ? 'text-gold' : u >= 0 ? 'text-jade-light' : 'text-slate-500';

  const [analystInput, setAnalystInput] = useState(row.analyst?.toString() ?? '');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 24, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 220, damping: 24, delay: Math.min(rank * 0.06, 0.3) }}
      className={`lift shine relative overflow-hidden bg-ink-900 ring-1 rounded-2xl p-4 space-y-3 ${
        isChampion ? 'ring-gold/60 animate-glow-pulse' : isPodium ? 'ring-gold/30' : 'ring-ink-800'
      }`}
    >
      {/* ランクメダル (右上) */}
      {meta && (
        <div className={`absolute -top-2 -right-2 z-10 flex items-center gap-1 px-2.5 py-1 rounded-full font-extrabold text-[10px] tracking-wide ring-2 ${meta.cls} ${meta.ring}`}>
          <meta.Icon size={12} strokeWidth={3} />
          {meta.label}
        </div>
      )}

      <div className="flex items-start gap-3">
        {/* スコアサークル: チャンピオンは大きく＆カウントアップ */}
        <div
          className={`relative ${isChampion ? 'w-20 h-20' : isPodium ? 'w-16 h-16' : 'w-12 h-12'} rounded-2xl bg-gradient-to-br ${scoreClass} flex items-center justify-center shadow-lg shrink-0 ${
            isChampion ? 'animate-pop-in' : ''
          }`}
        >
          <div className="text-center leading-none">
            <div className={`font-extrabold tabular-nums ${isChampion ? 'text-3xl' : isPodium ? 'text-2xl' : 'text-lg'}`}>
              <AnimatedNumber value={r.score} duration={1200} decimals={0} />
            </div>
            <div className={`opacity-80 ${isChampion ? 'text-[9px]' : 'text-[8px]'} font-bold tracking-widest mt-0.5`}>SCORE</div>
          </div>
          {isChampion && (
            <Sparkles size={14} className="absolute -top-1 -left-1 text-yellow-200 animate-sparkle" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className={`font-bold ${isPodium ? 'text-gold' : ''}`}>#{rank}</span>
            <span className="font-mono">{r.ticker}</span>
          </div>
          <div className={`font-bold truncate ${isChampion ? 'text-xl text-gradient-gold' : 'text-white'}`}>{r.name}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            現在値 <span className="text-white tabular-nums">¥{r.price.toLocaleString()}</span>
          </div>
          {r.notes.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {r.notes.map((n, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-jade/10 text-jade-light ring-1 ring-jade/30">
                  {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 内訳 */}
      <div className="grid grid-cols-4 gap-1.5 text-center text-[10px]">
        <Metric label="成長" value={r.breakdown.growth} />
        <Metric label="ブレイク" value={r.breakdown.breakout} />
        <Metric label="クオリティ" value={r.breakdown.quality} />
        <Metric label="バリュー" value={r.breakdown.valuation} />
      </div>

      {/* 3種ターゲット */}
      <div className="space-y-1.5 bg-ink-950/50 rounded-xl p-3">
        <h4 className="text-[10px] text-gold font-bold flex items-center gap-1">
          <Target size={10} /> 上昇後の予想株価
        </h4>
        <TargetRow
          label="テクニカル"
          target={r.targets.technical}
          color="text-jade-light"
          upClass={upColor(r.targets.technical.upside)}
        />
        <TargetRow
          label="ファンダ"
          target={r.targets.fundamental}
          color="text-gold"
          upClass={upColor(r.targets.fundamental.upside)}
        />
        <TargetRow
          label="アナリスト"
          target={r.targets.analyst}
          color="text-cinnabar-light"
          upClass={upColor(r.targets.analyst.upside)}
        />
        {/* アナリスト目標の手動入力 */}
        <div className="flex items-center gap-1.5 pt-1.5 mt-1.5 border-t border-ink-800">
          <span className="text-[10px] text-slate-500 shrink-0">アナリスト目標を入力</span>
          <input
            type="number"
            inputMode="numeric"
            value={analystInput}
            onChange={(e) => setAnalystInput(e.target.value)}
            placeholder="円"
            className="flex-1 bg-ink-800 ring-1 ring-ink-700 rounded px-2 py-0.5 text-[11px] text-white tabular-nums w-16"
          />
          <button
            onClick={() => onSetAnalyst(Number(analystInput))}
            disabled={!analystInput || isNaN(Number(analystInput))}
            className="text-[10px] px-2 py-0.5 rounded bg-cinnabar/20 ring-1 ring-cinnabar/40 text-cinnabar-light disabled:opacity-40"
          >
            設定
          </button>
          <a
            href={`https://kabutan.jp/stock/?code=${r.ticker}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] text-slate-400 hover:text-gold flex items-center gap-0.5"
            title="kabutan で開く"
          >
            <ExternalLink size={10} /> 株探
          </a>
        </div>
      </div>

      {/* 上昇余地サマリ — ヘッドライン */}
      {r.bestUpside != null && (
        <div className={`relative overflow-hidden flex items-center justify-between rounded-xl px-4 py-3 ring-1 ${
          r.bestUpside >= 30
            ? 'bg-gradient-to-r from-cinnabar/20 via-gold/15 to-cinnabar/20 ring-cinnabar/40 animate-gradient'
            : r.bestUpside >= 10
            ? 'bg-gradient-to-r from-gold/15 to-jade/10 ring-gold/30'
            : 'bg-gradient-to-r from-jade/10 to-ink-900 ring-ink-800'
        }`}>
          <span className="text-xs text-slate-200 flex items-center gap-1.5 font-medium">
            <TrendingUp size={14} className="text-gold-light" /> 最大上昇余地
          </span>
          <span className={`font-extrabold tabular-nums text-2xl ${upColor(r.bestUpside)}`}>
            {r.bestUpside >= 0 ? '+' : ''}
            <AnimatedNumber value={r.bestUpside} duration={1100} decimals={1} />
            <span className="text-base ml-0.5">%</span>
          </span>
        </div>
      )}

      {/* アクション */}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onAddWatchlist}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-ink-800 ring-1 ring-jade/40 text-jade-light text-xs"
        >
          <Plus size={12} /> ウォッチリストに追加
        </button>
        <Link
          href={`/stock/${r.ticker}`}
          className="flex-1 flex items-center justify-center gap-1 py-2 rounded-xl bg-gradient-to-r from-gold/20 to-jade/20 ring-1 ring-gold/40 text-gold text-xs"
        >
          マンダラで詳細分析
        </Link>
      </div>
    </motion.div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  const v = Math.round(value);
  const color =
    v >= 75 ? 'bg-gold/20 text-gold ring-gold/30'
    : v >= 50 ? 'bg-jade/20 text-jade-light ring-jade/30'
    : 'bg-ink-800 text-slate-400 ring-ink-700';
  return (
    <div className={`rounded-lg ring-1 px-1.5 py-1 ${color}`}>
      <div className="font-bold text-sm tabular-nums">{v}</div>
      <div className="opacity-70">{label}</div>
    </div>
  );
}

function TargetRow({
  label, target, color, upClass,
}: {
  label: string;
  target: { value: number | null; method: string; upside: number | null };
  color: string;
  upClass: string;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={`shrink-0 w-16 ${color}`}>{label}</span>
      <span className="text-white tabular-nums shrink-0 w-16 text-right">
        {target.value != null ? `¥${target.value.toLocaleString()}` : '—'}
      </span>
      <span className={`shrink-0 w-14 text-right tabular-nums ${upClass}`}>
        {target.upside != null ? `${target.upside >= 0 ? '+' : ''}${target.upside.toFixed(1)}%` : '—'}
      </span>
      <span className="text-slate-500 truncate text-[10px] flex-1">{target.method}</span>
    </div>
  );
}
