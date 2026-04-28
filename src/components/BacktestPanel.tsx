'use client';

import { useState } from 'react';
import { Loader2, FlaskConical } from 'lucide-react';
import type { Snapshot } from '@/domain/types';
import { runBacktest, type BacktestResult } from '@/lib/backtest';

interface Props {
  ticker: string;
  snapshots: Snapshot[];
}

export default function BacktestPanel({ ticker, snapshots }: Props) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(20);

  const onRun = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/quote?ticker=${ticker}&days=400`);
      if (!res.ok) throw new Error(`株価取得失敗 (${res.status})`);
      const data = (await res.json()) as { daily: { date: string; c: number | null }[] };
      const r = runBacktest(snapshots, data.daily, windowDays);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-serif">バックテスト</div>
        <FlaskConical size={14} className="text-gold/60" />
      </div>

      {snapshots.length < 5 && (
        <div className="text-xs text-slate-500 text-center py-2">
          バックテストには 5 日分以上のスナップショットが必要（現在 {snapshots.length} 日）
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <label className="text-xs text-slate-400">先読み</label>
        <select
          value={windowDays}
          onChange={(e) => setWindowDays(Number(e.target.value))}
          className="bg-ink-800 ring-1 ring-ink-700 rounded-lg px-2 py-1 text-xs text-white"
        >
          <option value={5}>5日</option>
          <option value={10}>10日</option>
          <option value={20}>20日</option>
          <option value={60}>60日</option>
        </select>
        <button
          onClick={onRun}
          disabled={loading || snapshots.length < 5}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-gold/20 ring-1 ring-gold/40 text-gold-light text-xs font-medium disabled:opacity-40 active:scale-95"
        >
          {loading ? <Loader2 size={12} className="animate-spin" /> : null}
          実行
        </button>
      </div>

      {error && (
        <div className="text-[10px] text-cinnabar-light bg-cinnabar/10 rounded px-2 py-1 mb-2">{error}</div>
      )}

      {result && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <Stat label="勝率" value={`${(result.winRate * 100).toFixed(0)}%`} />
          <Stat label="平均リターン" value={`${result.avgReturn.toFixed(2)}%`} highlight={result.avgReturn > 0} />
          <Stat label="相関係数" value={result.correlation.toFixed(3)} />
          <Stat label="サンプル数" value={`${result.points.length}`} />
          <Stat
            label="80以上の勝率"
            value={result.highScore.count > 0 ? `${(result.highScore.winRate * 100).toFixed(0)}% (${result.highScore.count})` : '—'}
          />
          <Stat
            label="80以上の平均"
            value={result.highScore.count > 0 ? `${result.highScore.avgReturn.toFixed(2)}%` : '—'}
            highlight={result.highScore.avgReturn > 0}
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="bg-ink-800 rounded-lg px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${highlight ? 'text-jade-light' : 'text-white'}`}>{value}</div>
    </div>
  );
}
