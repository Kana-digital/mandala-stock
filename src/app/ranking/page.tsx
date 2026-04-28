'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { ChevronLeft, TrendingUp, RefreshCw, Sparkles } from 'lucide-react';

interface RankingItem {
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
  categoryScores: Array<{ key: string; name: string; score: number }>;
}

interface RankingResp {
  total: number;
  universeSize: number;
  generatedAt: string;
  sortBy: 'predicted' | 'analyst' | 'total';
  items: RankingItem[];
}

export default function RankingPage() {
  const [data, setData] = useState<RankingResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'predicted' | 'analyst' | 'total'>('predicted');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (sb: typeof sortBy, force = false) => {
    setRefreshing(true);
    setError(null);
    try {
      const r = await fetch(`/api/ranking?limit=20&sortBy=${sb}${force ? `&_=${Date.now()}` : ''}`);
      if (!r.ok) {
        const t = await r.text();
        throw new Error(`${r.status}: ${t.slice(0, 200)}`);
      }
      setData(await r.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load(sortBy);
  }, [sortBy]);

  return (
    <main className="min-h-dvh relative">
      <div aria-hidden className="fixed inset-0 -z-10 aurora opacity-60" />

      <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-950/70 border-b border-gold/20">
        <div className="max-w-md mx-auto flex items-center justify-between px-4 py-3">
          <Link href="/" className="text-slate-300 hover:text-gold p-1 -ml-1">
            <ChevronLeft size={22} />
          </Link>
          <h1 className="text-base font-bold flex items-center gap-2">
            <TrendingUp size={18} className="text-gold-light" />
            <span className="text-gradient-gold">予測上昇率ランキング</span>
          </h1>
          <button
            onClick={() => load(sortBy, true)}
            disabled={refreshing}
            className="text-slate-300 hover:text-gold p-1 disabled:opacity-50"
            aria-label="更新"
            title="更新"
          >
            <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      <div className="max-w-md mx-auto px-4 py-4 pb-24">
        {/* ソート切替 */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto scrollbar-hide">
          {([
            { id: 'predicted', label: '総合予測上昇率' },
            { id: 'analyst', label: 'アナリスト目標' },
            { id: 'total', label: '総合スコア' },
          ] as const).map((s) => (
            <button
              key={s.id}
              onClick={() => setSortBy(s.id)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full ring-1 transition ${
                sortBy === s.id
                  ? 'bg-gold/20 ring-gold text-gold'
                  : 'bg-ink-900 ring-ink-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {data && (
          <div className="text-[10px] text-slate-500 mb-3 px-1">
            {data.universeSize} 銘柄から計算 ・ {new Date(data.generatedAt).toLocaleString('ja-JP')}
          </div>
        )}

        {error && (
          <div className="bg-red-950/40 ring-1 ring-red-500/40 rounded-2xl p-4 text-sm text-red-200">
            <div className="font-bold mb-1">エラー</div>
            <div className="text-xs font-mono break-all">{error}</div>
          </div>
        )}

        {!data && !error && (
          <div className="text-center py-12 text-slate-500 text-sm">
            <Sparkles size={32} className="text-gold-light/40 mx-auto mb-3 animate-sparkle" />
            日経225 を分析中…<br />
            <span className="text-[10px] opacity-70">初回は30〜60秒かかります（Yahoo Finance から取得）</span>
          </div>
        )}

        {data && data.items.length === 0 && (
          <div className="text-center py-12 text-slate-500 text-sm">該当銘柄がありません</div>
        )}

        <div className="space-y-2">
          {data?.items.map((it, i) => {
            const upside = sortBy === 'analyst' ? it.analystUpsidePct : it.predictedUpsidePct;
            const upsideColor = upside == null ? 'text-slate-400' : upside >= 20 ? 'text-jade-light' : upside >= 10 ? 'text-jade' : upside >= 0 ? 'text-slate-300' : 'text-red-400';
            return (
              <motion.div
                key={it.code}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
              >
                <Link
                  href={`/mandala/${it.code}`}
                  className="lift block bg-ink-900 ring-1 ring-ink-800 hover:ring-gold/40 rounded-2xl p-3.5 active:scale-[0.99] transition"
                >
                  <div className="flex items-center gap-3">
                    {/* 順位 */}
                    <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm ${
                      i < 3 ? 'bg-gradient-to-br from-gold to-gold-dark text-ink-950' :
                      i < 10 ? 'bg-gold/20 text-gold ring-1 ring-gold/40' :
                      'bg-ink-800 text-slate-400'
                    }`}>
                      {i + 1}
                    </div>
                    {/* 銘柄情報 */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] text-slate-400">{it.code}</span>
                        {it.sector && <span className="text-[10px] text-slate-500 truncate">{it.sector}</span>}
                      </div>
                      <div className="font-bold text-white truncate text-sm">{it.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] text-slate-400">¥{Math.round(it.price).toLocaleString()}</span>
                        <span className="text-[10px] text-slate-600">→</span>
                        <span className="text-[11px] text-slate-300">¥{Math.round(sortBy === 'analyst' ? (it.targetMeanPrice ?? it.predictedPrice) : it.predictedPrice).toLocaleString()}</span>
                      </div>
                    </div>
                    {/* 上昇率 */}
                    <div className="shrink-0 text-right">
                      <div className={`text-lg font-bold ${upsideColor} tabular-nums`}>
                        {upside == null ? '—' : `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%`}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        スコア {Math.round(it.totalScore)}
                      </div>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
