'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, RefreshCw, Sparkles, Info } from 'lucide-react';

interface MandalaCell {
  label: string;
  display: string;
  score: number | null;
  raw?: number | null;
  hint?: string;
}

interface CategoryBlock {
  key: string;
  name: string;
  score: number;
  cells: MandalaCell[];
}

interface MandalaResult {
  ticker: string;
  code: string;
  name: string;
  sector: string | null;
  price: number;
  targetMeanPrice: number | null;
  analystUpsidePct: number | null;
  predictedPrice: number;
  predictedUpsidePct: number;
  totalScore: number;
  categories: CategoryBlock[];
  centerCells: MandalaCell[];
}

// 中央 3x3 における 8 カテゴリの配置順 (row-major、index 4 = 中心銘柄)
// [growth, profitability, valuation, health, [center], momentum, technical, volume, forecast]
const CENTER_CAT_ORDER = ['growth', 'profitability', 'valuation', 'health', null, 'momentum', 'technical', 'volume', 'forecast'];

export default function MandalaPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const [data, setData] = useState<MandalaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ cat: string; idx: number } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/mandala/${ticker}`);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status}: ${t.slice(0, 200)}`);
      }
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const catByKey = (key: string) => data?.categories.find((c) => c.key === key);

  const colorFor = (score: number | null) => {
    if (score == null) return 'bg-ink-800 text-slate-400';
    if (score >= 80) return 'bg-jade-light/30 text-jade-light ring-jade-light/60';
    if (score >= 60) return 'bg-jade/25 text-jade-light ring-jade/40';
    if (score >= 40) return 'bg-gold/20 text-gold ring-gold/40';
    if (score >= 20) return 'bg-orange-500/20 text-orange-300 ring-orange-500/40';
    return 'bg-red-500/20 text-red-300 ring-red-500/40';
  };

  return (
    <main className="min-h-dvh relative">
      <div aria-hidden className="fixed inset-0 -z-10 aurora opacity-60" />

      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-3">
          <Link href="/ranking" className="text-slate-300 hover:text-gold p-1 -ml-1">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="text-base font-bold flex items-center gap-2">
            <Sparkles size={16} className="text-gold-light" />
            <span className="text-gradient-gold">曼荼羅チャート</span>
          </h1>
          <button onClick={load} disabled={loading} className="text-slate-300 hover:text-gold p-1 disabled:opacity-50">
            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <div className="max-w-md mx-auto px-3 py-4 pb-24 space-y-4">
        {loading && !data && (
          <div className="text-center py-16 text-slate-500 text-sm">
            <Sparkles size={32} className="text-gold-light/40 mx-auto mb-3 animate-sparkle" />
            分析中…
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 ring-1 ring-red-500/40 rounded-2xl p-4 text-sm text-red-200">
            <div className="font-bold mb-1">取得失敗</div>
            <div className="text-xs font-mono break-all">{error}</div>
          </div>
        )}

        {data && (
          <>
            {/* ヘッダーカード */}
            <div className="bg-ink-900 ring-1 ring-gold/30 rounded-2xl p-4">
              <div className="flex items-baseline gap-2 mb-1">
                <span className="font-mono text-xs text-slate-400">{data.code}</span>
                {data.sector && <span className="text-[10px] text-slate-500">{data.sector}</span>}
              </div>
              <div className="text-xl font-bold text-white">{data.name}</div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div>
                  <div className="text-[10px] text-slate-500">現在株価</div>
                  <div className="font-bold text-white">¥{Math.round(data.price).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">予測株価</div>
                  <div className="font-bold text-gold">¥{Math.round(data.predictedPrice).toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">予測上昇率</div>
                  <div className={`font-bold tabular-nums ${data.predictedUpsidePct >= 10 ? 'text-jade-light' : data.predictedUpsidePct >= 0 ? 'text-slate-300' : 'text-red-400'}`}>
                    {data.predictedUpsidePct >= 0 ? '+' : ''}{data.predictedUpsidePct.toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-center text-[11px]">
                <div className="bg-ink-800/60 rounded-lg py-1.5">
                  <span className="text-slate-500">アナリスト目標 </span>
                  <span className="text-slate-200">¥{data.targetMeanPrice ? Math.round(data.targetMeanPrice).toLocaleString() : '—'}</span>
                  {data.analystUpsidePct != null && (
                    <span className={`ml-1 ${data.analystUpsidePct >= 0 ? 'text-jade-light' : 'text-red-400'}`}>
                      ({data.analystUpsidePct >= 0 ? '+' : ''}{data.analystUpsidePct.toFixed(1)}%)
                    </span>
                  )}
                </div>
                <div className="bg-ink-800/60 rounded-lg py-1.5">
                  <span className="text-slate-500">総合スコア </span>
                  <span className="text-gold">{Math.round(data.totalScore)}</span>
                  <span className="text-slate-600">/800</span>
                </div>
              </div>
            </div>

            {/* 中央 3x3: 8 カテゴリ + 中心銘柄 */}
            <div>
              <h2 className="text-xs text-slate-400 mb-2 px-1 flex items-center gap-1">
                <Info size={11} /> マスをタップで詳細（9x9 全 81 セル）
              </h2>
              <div className="grid grid-cols-3 gap-1.5 aspect-square">
                {CENTER_CAT_ORDER.map((catKey, i) => {
                  if (catKey === null) {
                    // 中心の銘柄セル
                    return (
                      <div
                        key="center"
                        className="bg-gradient-to-br from-gold/30 to-gold-dark/30 ring-2 ring-gold rounded-xl p-2 flex flex-col items-center justify-center text-center"
                      >
                        <div className="text-[10px] text-gold-light truncate w-full">{data.code}</div>
                        <div className="font-bold text-white text-[11px] leading-tight line-clamp-2">{data.name}</div>
                        <div className="text-[10px] text-gold mt-0.5">¥{Math.round(data.price).toLocaleString()}</div>
                      </div>
                    );
                  }
                  const cat = catByKey(catKey);
                  if (!cat) return <div key={i} className="bg-ink-800 rounded-xl" />;
                  const isOpen = selectedCat === catKey;
                  return (
                    <button
                      key={catKey}
                      onClick={() => setSelectedCat(isOpen ? null : catKey)}
                      className={`rounded-xl p-2 flex flex-col items-center justify-center text-center ring-1 transition ${colorFor(cat.score)} ${isOpen ? 'ring-2 scale-[0.98]' : 'hover:ring-2'}`}
                    >
                      <div className="text-[11px] font-medium leading-tight">{cat.name}</div>
                      <div className="text-base font-bold tabular-nums">{Math.round(cat.score)}</div>
                      <div className="text-[9px] opacity-70">点</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 選択カテゴリの 3x3 詳細 */}
            <AnimatePresence mode="wait">
              {selectedCat && (() => {
                const cat = catByKey(selectedCat);
                if (!cat) return null;
                return (
                  <motion.div
                    key={selectedCat}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-ink-900 ring-1 ring-ink-800 rounded-2xl p-3"
                  >
                    <h3 className="text-sm font-bold mb-2 px-1 flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${cat.score >= 60 ? 'bg-jade-light' : cat.score >= 40 ? 'bg-gold' : 'bg-red-400'}`} />
                      {cat.name}
                      <span className="text-xs text-slate-500 ml-auto">{Math.round(cat.score)} / 100点</span>
                    </h3>
                    <div className="grid grid-cols-3 gap-1.5">
                      {cat.cells.map((cell, idx) => {
                        const isCenter = idx === 4;
                        const isSelected = selectedCell?.cat === selectedCat && selectedCell?.idx === idx;
                        return (
                          <button
                            key={idx}
                            onClick={() => setSelectedCell(isSelected ? null : { cat: selectedCat, idx })}
                            className={`rounded-lg p-2 text-center ring-1 transition min-h-[68px] flex flex-col justify-center ${
                              isCenter
                                ? 'bg-gold/20 ring-gold text-gold'
                                : `${colorFor(cell.score)} ${isSelected ? 'ring-2' : ''}`
                            }`}
                          >
                            <div className="text-[10px] leading-tight line-clamp-2">{cell.label}</div>
                            <div className={`font-bold tabular-nums ${isCenter ? 'text-base' : 'text-xs'} mt-0.5`}>
                              {cell.display || '—'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {/* 選択セルの詳細 */}
                    {selectedCell && selectedCell.cat === selectedCat && (() => {
                      const cell = cat.cells[selectedCell.idx];
                      return (
                        <div className="mt-2 bg-ink-800/60 rounded-lg p-2.5 text-xs">
                          <div className="text-slate-400">{cell.label}</div>
                          <div className="text-white font-bold text-sm">{cell.display}</div>
                          {cell.score != null && (
                            <div className="text-[10px] text-slate-500 mt-1">スコア {Math.round(cell.score)}/100</div>
                          )}
                          {cell.hint && <div className="text-[10px] text-slate-500 mt-1">{cell.hint}</div>}
                        </div>
                      );
                    })()}
                  </motion.div>
                );
              })()}
            </AnimatePresence>

            {/* 全カテゴリ一覧 (リスト形式) */}
            <div>
              <h2 className="text-xs text-slate-400 mb-2 px-1">8カテゴリ一覧</h2>
              <div className="grid grid-cols-2 gap-1.5">
                {data.categories.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setSelectedCat(c.key)}
                    className={`rounded-lg p-2 text-left ring-1 ${colorFor(c.score)} hover:ring-2 transition`}
                  >
                    <div className="text-xs font-medium">{c.name}</div>
                    <div className="text-base font-bold tabular-nums">{Math.round(c.score)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="text-[10px] text-slate-600 text-center pt-2">
              データ: Yahoo Finance ・ 分析: マンダラ株独自スコア
            </div>
          </>
        )}
      </div>
    </main>
  );
}
