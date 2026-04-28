'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import type { SimilarStock } from '@/lib/similarity';

interface Props {
  similar: SimilarStock[];
}

export default function SimilarStocks({ similar }: Props) {
  const usable = similar.filter((s) => s.similarity > 0);
  if (usable.length === 0) {
    return (
      <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-serif">類似銘柄</div>
        <div className="text-xs text-slate-500 text-center py-4">
          他の銘柄を 2 つ以上登録してスコア入力すると<br />
          コサイン類似度で似た銘柄が表示されます
        </div>
      </div>
    );
  }

  return (
    <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-serif">類似銘柄 (8軸コサイン)</div>
        <Sparkles size={14} className="text-gold/60" />
      </div>
      <div className="space-y-2">
        {usable.map((s) => (
          <Link
            key={s.ticker}
            href={`/stock/${s.ticker}`}
            className="flex items-center justify-between bg-ink-800 hover:bg-ink-700 ring-1 ring-ink-700 rounded-xl px-3 py-2 transition active:scale-[0.99]"
          >
            <div className="flex-1 min-w-0">
              <div className="font-mono text-[10px] text-slate-500">{s.ticker}</div>
              <div className="text-sm text-white truncate">{s.name}</div>
            </div>
            <div className="text-right ml-2">
              <div className="text-xs font-bold text-gold">
                {(s.similarity * 100).toFixed(0)}%
              </div>
              {s.totalScore !== null && (
                <div className="text-[10px] text-slate-400">
                  総合 {s.totalScore}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
