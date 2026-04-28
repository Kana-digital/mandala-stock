'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import type { Cell } from '@/domain/types';

interface Props {
  open: boolean;
  cell: Cell | null;
  onClose: () => void;
  onSave: (updated: Cell) => void;
}

export default function CellEditor({ open, cell, onClose, onSave }: Props) {
  const [score, setScore] = useState<number | ''>('');
  const [memo, setMemo] = useState('');
  const [value, setValue] = useState('');

  useEffect(() => {
    if (cell) {
      setScore(typeof cell.score === 'number' ? cell.score : '');
      setMemo(cell.memo ?? '');
      setValue(cell.value !== undefined ? String(cell.value) : '');
    }
  }, [cell]);

  if (!cell) return null;

  const handleSave = () => {
    onSave({
      ...cell,
      score: score === '' ? undefined : Number(score),
      memo: memo || undefined,
      value: value || undefined,
      updatedAt: new Date().toISOString(),
    });
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className="w-full max-w-md bg-ink-900 ring-1 ring-gold/40 rounded-3xl p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gold">{cell.label}</h2>
              <button onClick={onClose} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">スコア（0〜100）</label>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  value={score}
                  onChange={(e) => setScore(e.target.value === '' ? '' : Math.max(0, Math.min(100, Number(e.target.value))))}
                  className="w-full bg-ink-800 ring-1 ring-ink-700 focus:ring-gold rounded-xl px-3 py-2 text-white text-2xl font-bold tabular-nums"
                  placeholder="—"
                />
                <div className="mt-1 grid grid-cols-4 gap-1 text-[10px]">
                  {[
                    { label: '見送り', range: '0-59', color: 'bg-cinnabar-dark' },
                    { label: '中立', range: '60-79', color: 'bg-jade-dark' },
                    { label: '買い', range: '80-100', color: 'bg-gold-dark' },
                    { label: '未評価', range: '空欄', color: 'bg-ink-800' },
                  ].map((g) => (
                    <div key={g.label} className={`${g.color} rounded text-center px-1 py-0.5 text-white/90`}>
                      {g.label}<br /><span className="opacity-60">{g.range}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">参考値・データ</label>
                <input
                  type="text"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full bg-ink-800 ring-1 ring-ink-700 focus:ring-gold rounded-xl px-3 py-2 text-white text-sm"
                  placeholder="例：PER 18.5 / 売上 +12% / 大量保有 ○○ファンド"
                />
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1">メモ</label>
                <textarea
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  rows={3}
                  className="w-full bg-ink-800 ring-1 ring-ink-700 focus:ring-gold rounded-xl px-3 py-2 text-white text-sm resize-none"
                  placeholder="判断根拠・気になった点など"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl bg-ink-800 text-slate-300 font-medium hover:bg-ink-700"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSave}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-ink-950 font-bold shadow-lg shadow-gold/30 hover:from-gold-light"
                >
                  保存
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
