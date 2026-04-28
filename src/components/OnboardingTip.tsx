'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, BookOpen } from 'lucide-react';

const KEY = 'mandala-onboarded-v1';

/**
 * 初回起動時に「ようこそ」を出すバナー。
 * localStorage に既読フラグを残して 2回目以降は表示しない。
 * 「使い方を見る」リンクで /help へ。
 */
export default function OnboardingTip() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!localStorage.getItem(KEY)) setVisible(true);
    } catch {
      // localStorage 不可（プライベートモード等）→ 表示しない
    }
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          className="bg-gradient-to-br from-gold/15 via-jade/10 to-cinnabar/10 ring-1 ring-gold/40 rounded-2xl p-4 relative"
        >
          <button
            onClick={dismiss}
            className="absolute top-2 right-2 p-1 text-slate-400 hover:text-white"
            aria-label="閉じる"
          >
            <X size={14} />
          </button>
          <h3 className="font-serif text-gold text-sm flex items-center gap-1.5 mb-1">
            <Sparkles size={14} className="text-gold-light" /> ようこそ、マンダラ株へ
          </h3>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            ① 右下の「＋」で気になる銘柄を追加 →
            ② カードをタップしてマンダラを開く →
            ③ 各セルをタップしてスコア入力（または「API自動入力」）。
            8軸×8セルで多角的に分析できます。
          </p>
          <div className="flex gap-2 mt-3">
            <Link
              href="/help"
              onClick={dismiss}
              className="flex-1 flex items-center justify-center gap-1.5 text-xs py-2 rounded-full bg-ink-900 ring-1 ring-gold/30 text-gold"
            >
              <BookOpen size={12} /> 使い方を見る
            </Link>
            <button
              onClick={dismiss}
              className="flex-1 text-xs py-2 rounded-full bg-gradient-to-r from-gold to-gold-dark text-ink-950 font-bold"
            >
              はじめる
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
