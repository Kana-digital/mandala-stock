'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Settings as SettingsIcon, Sparkles, Search, X, ArrowDownAZ, ArrowDownZA, TrendingUp, TrendingDown, Clock, Target, Crown } from 'lucide-react';
import { listStocks, saveStock } from '@/storage/db';
import { createNewStock } from '@/domain/seed';
import { completionCount, judgement } from '@/domain/scoring';
import type { Stock } from '@/domain/types';
import ScoreBadge from '@/components/ScoreBadge';
import CompletionRing from '@/components/CompletionRing';
import BadgeShelf from '@/components/BadgeShelf';
import Sparkline from '@/components/Sparkline';
import OnboardingTip from '@/components/OnboardingTip';
import { badgesForPortfolio } from '@/lib/badges';
import { autoSnapshotIfNeeded } from '@/lib/auto-snapshot';
import { listSnapshots } from '@/storage/db';
import type { Snapshot } from '@/domain/types';

export default function Home() {
  const [stocks, setStocks] = useState<Stock[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [ticker, setTicker] = useState('');
  const [name, setName] = useState('');

  const [autoSnapCount, setAutoSnapCount] = useState(0);
  const [snapMap, setSnapMap] = useState<Record<string, Snapshot[]>>({});

  // 検索・並び替え・フィルター
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<'score' | 'updated' | 'name'>('score');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [filterJ, setFilterJ] = useState<'all' | 'buy' | 'hold' | 'sell'>('all');

  useEffect(() => {
    listStocks().then(async (list) => {
      setStocks(list);
      // 今日のスナップショットがまだ無い銘柄を自動保存
      const created = await autoSnapshotIfNeeded(list);
      if (created.length > 0) setAutoSnapCount(created.length);
      // 各銘柄の直近スナップショット履歴を取得 (スパークライン用)
      const map: Record<string, Snapshot[]> = {};
      await Promise.all(
        list.map(async (s) => {
          map[s.ticker] = await listSnapshots(s.ticker);
        })
      );
      setSnapMap(map);
    });
  }, []);

  const refresh = async () => setStocks(await listStocks());

  const onAdd = async () => {
    if (!ticker.trim() || !name.trim()) return;
    const s = createNewStock(ticker.trim(), name.trim());
    await saveStock(s);
    setTicker('');
    setName('');
    setShowAdd(false);
    refresh();
  };

  // フィルター → 検索 → 並び替え
  const visible = (stocks ?? [])
    .filter((s) => {
      if (filterJ === 'all') return true;
      return judgement(s.root.cells[4].score) === filterJ;
    })
    .filter((s) => {
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        s.ticker.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.sector ?? '').toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1;
      if (sortKey === 'name') return a.name.localeCompare(b.name, 'ja') * dir;
      if (sortKey === 'updated') return (a.updatedAt < b.updatedAt ? -1 : 1) * dir;
      const sa = a.root.cells[4].score ?? -1;
      const sb = b.root.cells[4].score ?? -1;
      return (sa - sb) * dir;
    });

  const totalCount = (stocks ?? []).length;
  const filterActive = filterJ !== 'all' || query.trim() !== '';

  return (
    <main className="min-h-dvh relative">
      {/* オーロラ背景 (薄く動く) */}
      <div aria-hidden className="fixed inset-0 -z-10 aurora opacity-60" />

      {/* ヘッダー */}
      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-3">
          <h1 className="text-xl font-serif tracking-wide flex items-center gap-2">
            <Sparkles size={20} className="text-gold-light animate-sparkle" />
            <span className="text-gradient-gold">マンダラ株</span>
          </h1>
          <div className="flex items-center gap-1">
            <Link
              href="/ranking"
              className="text-gold p-2 flex items-center gap-1.5"
              title="予測上昇率ランキング"
            >
              <Crown size={18} />
              <span className="text-[11px] font-medium">ランキング</span>
            </Link>
            <Link href="/settings" className="text-slate-300 hover:text-gold p-2" title="設定">
              <SettingsIcon size={20} />
            </Link>
          </div>
        </div>
      </header>

      {/* リスト */}
      <div className="max-w-md mx-auto px-4 py-4 space-y-3 pb-24">
        <OnboardingTip />

        {/* メインCTA: 予測上昇率ランキング */}
        <Link
          href="/ranking"
          className="lift shine relative overflow-hidden block bg-gradient-to-br from-gold/20 via-gold-dark/15 to-transparent ring-1 ring-gold/40 rounded-2xl p-4 active:scale-[0.99] transition"
        >
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-gold to-gold-dark text-ink-950 flex items-center justify-center shadow-lg shadow-gold/30">
              <Crown size={22} strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gold-light">予測上昇率ランキング TOP20</div>
              <div className="text-[11px] text-slate-400 mt-0.5">日経225を9x9曼荼羅でスコア化 → タップで詳細</div>
            </div>
            <TrendingUp size={18} className="text-gold shrink-0" />
          </div>
        </Link>

        {autoSnapCount > 0 && (
          <div className="text-[10px] text-jade-light bg-jade/10 ring-1 ring-jade/30 rounded-full px-3 py-1.5 text-center">
            ✓ 今日のスナップショットを {autoSnapCount} 銘柄自動保存しました
          </div>
        )}
        {stocks !== null && stocks.length > 0 && (
          <BadgeShelf badges={badgesForPortfolio(stocks)} title="ポートフォリオの徽章" />
        )}
        {stocks === null && <div className="text-center text-slate-500 py-12">読み込み中…</div>}

        {/* 検索・フィルター・並び替え */}
        {stocks !== null && stocks.length >= 3 && (
          <div className="space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ティッカー・銘柄名・セクターで検索"
                className="w-full bg-ink-900 ring-1 ring-ink-800 focus:ring-gold/40 rounded-full pl-9 pr-9 py-2 text-sm text-white placeholder:text-slate-500"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                  aria-label="検索クリア"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
              {/* 判定フィルター */}
              {([
                { id: 'all', label: '全て' },
                { id: 'buy', label: '買い' },
                { id: 'hold', label: '中立' },
                { id: 'sell', label: '見送り' },
              ] as const).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterJ(f.id)}
                  className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full ring-1 transition ${
                    filterJ === f.id
                      ? 'bg-gold/20 ring-gold text-gold'
                      : 'bg-ink-900 ring-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <span className="w-px h-4 bg-ink-700 mx-1 shrink-0" />
              {/* 並び替えキー */}
              {([
                { id: 'score', label: 'スコア' },
                { id: 'updated', label: '更新日' },
                { id: 'name', label: '名前' },
              ] as const).map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSortKey(s.id)}
                  className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full ring-1 transition ${
                    sortKey === s.id
                      ? 'bg-jade/20 ring-jade text-jade-light'
                      : 'bg-ink-900 ring-ink-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {s.label}
                </button>
              ))}
              {/* 並び方向 */}
              <button
                onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
                className="shrink-0 text-[11px] px-2 py-1 rounded-full ring-1 bg-ink-900 ring-ink-800 text-slate-300 hover:ring-gold/40"
                aria-label="並び方向"
                title={sortDir === 'desc' ? '降順' : '昇順'}
              >
                {sortKey === 'name' ? (
                  sortDir === 'desc' ? <ArrowDownZA size={12} /> : <ArrowDownAZ size={12} />
                ) : sortKey === 'updated' ? (
                  <Clock size={12} />
                ) : (
                  sortDir === 'desc' ? <TrendingDown size={12} /> : <TrendingUp size={12} />
                )}
              </button>
            </div>
            {filterActive && (
              <div className="text-[10px] text-slate-500 px-1">
                {visible.length} / {totalCount} 件 表示中
              </div>
            )}
          </div>
        )}

        {stocks !== null && stocks.length === 0 && (
          <div className="text-center py-12 relative">
            <div className="relative inline-block">
              <div className="text-7xl mb-4 animate-float">🎴</div>
              <div className="absolute -top-2 -right-2 text-2xl animate-sparkle">✨</div>
              <div className="absolute -bottom-1 -left-3 text-xl animate-sparkle" style={{ animationDelay: '1.2s' }}>⭐</div>
            </div>
            <h2 className="text-2xl font-bold text-gradient-gold mb-2">冒険を始めよう</h2>
            <p className="text-slate-300 text-sm mb-6 px-6">
              気になる銘柄を登録して、<br />8つの軸で多角的に分析しよう。
            </p>
            <div className="flex flex-col gap-2 items-center">
              <button
                onClick={() => setShowAdd(true)}
                className="lift relative overflow-hidden shine inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-gold to-gold-dark text-ink-950 font-bold shadow-2xl shadow-gold/30 animate-glow-pulse"
              >
                <Plus size={18} strokeWidth={3} />
                最初の銘柄を追加
              </button>
              <Link
                href="/screener"
                className="lift inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-jade/20 ring-1 ring-jade/40 text-jade-light text-sm font-medium hover:bg-jade/30"
              >
                <Target size={14} />
                スクリーナーで高スコア銘柄を探す
              </Link>
            </div>
          </div>
        )}

        {stocks !== null && stocks.length > 0 && visible.length === 0 && (
          <div className="text-center py-10">
            <p className="text-slate-500 text-sm">該当する銘柄がありません</p>
            <button
              onClick={() => { setQuery(''); setFilterJ('all'); }}
              className="mt-3 text-xs text-gold hover:underline"
            >
              フィルターをクリア
            </button>
          </div>
        )}

        {visible.map((s) => {
          const total = s.root.cells[4].score;
          const cc = completionCount(s);
          return (
            <motion.div
              key={s.ticker}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <Link
                href={`/stock/${s.ticker}`}
                className="lift shine relative overflow-hidden block bg-ink-900 ring-1 ring-ink-800 hover:ring-gold/40 rounded-2xl p-4 shadow-lg active:scale-[0.99] transition"
              >
                <div className="flex items-center gap-3">
                  <CompletionRing filled={cc.filled} total={cc.total} size={52} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-400">{s.ticker}</span>
                      {s.sector && <span className="text-[10px] text-slate-500">/ {s.sector}</span>}
                    </div>
                    <div className="font-bold text-white truncate">{s.name}</div>
                    <div className="mt-1 flex items-center gap-2">
                      <ScoreBadge score={total} size="sm" />
                      <span className="text-[10px] text-slate-500">
                        {new Date(s.updatedAt).toLocaleDateString('ja-JP')} 更新
                      </span>
                    </div>
                  </div>
                  {snapMap[s.ticker]?.length >= 2 && (
                    <div className="ml-2 shrink-0">
                      <Sparkline snapshots={snapMap[s.ticker]} />
                    </div>
                  )}
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* 追加ボタン */}
      <button
        onClick={() => setShowAdd(true)}
        className="fixed bottom-6 right-6 w-16 h-16 rounded-full bg-gradient-to-br from-gold via-gold-light to-gold-dark text-ink-950 shadow-2xl shadow-gold/50 flex items-center justify-center animate-glow-pulse hover:scale-110 transition-transform z-40"
        aria-label="銘柄を追加"
      >
        <Plus size={32} strokeWidth={3} />
      </button>

      {/* 追加モーダル */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
            onClick={() => setShowAdd(false)}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-ink-900 ring-1 ring-gold/40 rounded-3xl p-5 shadow-2xl"
            >
              <h2 className="text-lg font-bold text-gold mb-4">銘柄を追加</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">ティッカー（証券コード）</label>
                  <input
                    type="text" inputMode="numeric" value={ticker}
                    onChange={(e) => setTicker(e.target.value)}
                    placeholder="例: 7203"
                    className="w-full bg-ink-800 ring-1 ring-ink-700 focus:ring-gold rounded-xl px-3 py-2 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">銘柄名</label>
                  <input
                    type="text" value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例: トヨタ自動車"
                    className="w-full bg-ink-800 ring-1 ring-ink-700 focus:ring-gold rounded-xl px-3 py-2 text-white"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setShowAdd(false)} className="flex-1 py-3 rounded-xl bg-ink-800 text-slate-300 font-medium">
                    キャンセル
                  </button>
                  <button onClick={onAdd} className="flex-1 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-ink-950 font-bold">
                    追加
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
