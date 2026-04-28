'use client';

import { motion } from 'framer-motion';
import type { Badge } from '@/lib/badges';

interface Props {
  badges: Badge[];
  title?: string;
}

export default function BadgeShelf({ badges, title }: Props) {
  return (
    <div className="bg-ink-900 ring-1 ring-gold/20 rounded-2xl p-3">
      {title && (
        <div className="text-[10px] uppercase tracking-widest text-slate-500 mb-2 font-serif">
          {title}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {badges.map((b, i) => (
          <motion.div
            key={b.id}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.04, type: 'spring', stiffness: 220 }}
            className={`aspect-square rounded-xl flex flex-col items-center justify-center text-center p-1 transition ${
              b.achieved
                ? 'bg-gradient-to-br from-gold/30 to-gold/10 ring-1 ring-gold/50 shadow-[0_0_18px_rgba(212,175,55,0.25)]'
                : 'bg-ink-800 ring-1 ring-slate-800 opacity-40 grayscale'
            }`}
            title={b.description}
          >
            <div className="text-2xl leading-none">{b.emoji}</div>
            <div className="text-[9px] mt-1 leading-tight font-medium text-slate-200">
              {b.name}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
