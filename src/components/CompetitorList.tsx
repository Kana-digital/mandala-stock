'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { saveStock, listStocks } from '@/storage/db';
import { createNewStock } from '@/domain/seed';

interface Props {
  ticker: string;
}

interface Competitor {
  Code: string;
  CompanyName: string;
  Sector33CodeName?: string;
}

interface ApiResponse {
  sector: string | null;
  competitors: Competitor[];
}

export default function CompetitorList({ ticker }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    listStocks().then((all) => setRegistered(new Set(all.map((s) => s.ticker))));
  }, []);

  const onLoad = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/competitors?ticker=${ticker}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const onAdd = async (c: Competitor) => {
    setAdding(c.Code);
    const t = c.Code.replace(/0$/, ''); // 5桁→4桁
    const stock = createNewStock(t, c.CompanyName, c.Sector33CodeName);
    await saveStock(stock);
    setRegistered((prev) => new Set([...prev, t]));
    setAdding(null);
  };

  return (
    <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-500 font-serif">同業種の銘柄</div>
        <Users size={14} className="text-gold/60" />
      </div>

      {!data && !loading && (
        <button
          onClick={onLoad}
          className="w-full py-2 rounded-xl bg-ink-800 ring-1 ring-ink-700 text-slate-300 text-sm hover:ring-gold/40 active:scale-[0.99] transition"
        >
          競合を読み込む
        </button>
      )}

      {loading && (
        <div className="flex items-center justify-center py-6 text-slate-500 gap-2">
          <Loader2 className="animate-spin" size={16} />
          <span className="text-xs">取得中…</span>
        </div>
      )}

      {error && (
        <div className="text-[10px] text-cinnabar-light bg-cinnabar/10 rounded px-2 py-1">{error}</div>
      )}

      {data && (
        <div className="space-y-2">
          {data.sector && (
            <div className="text-[10px] text-slate-400 mb-1">業種：{data.sector}</div>
          )}
          {data.competitors.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-3">同業種の他銘柄が見つかりません</div>
          ) : (
            data.competitors.map((c) => {
              const t = c.Code.replace(/0$/, '');
              const isReg = registered.has(t);
              return (
                <div
                  key={c.Code}
                  className="flex items-center justify-between bg-ink-800 ring-1 ring-ink-700 rounded-xl px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[10px] text-slate-500">{t}</div>
                    <div className="text-sm text-white truncate">{c.CompanyName}</div>
                  </div>
                  {isReg ? (
                    <span className="text-[10px] text-jade-light px-2">✓ 登録済</span>
                  ) : (
                    <button
                      onClick={() => onAdd(c)}
                      disabled={adding === c.Code}
                      className="text-[10px] px-2 py-1 rounded-lg bg-gold/20 ring-1 ring-gold/40 text-gold-light disabled:opacity-50"
                    >
                      {adding === c.Code ? '…' : '+ 追加'}
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
