'use client';

import { motion } from 'framer-motion';
import type { Mandala, Cell } from '@/domain/types';
import { scoreColor } from '@/domain/scoring';

interface Props {
  mandala: Mandala;
  /** 各セルクリック時。index 4（中心）を含む */
  onCellTap?: (index: number, cell: Cell) => void;
  /** 中心セルクリック時のラベル下に出す補助テキスト */
  centerSubLabel?: string;
}

export default function MandalaGrid({ mandala, onCellTap, centerSubLabel }: Props) {
  return (
    <div className="relative">
      {/* 背景の曼荼羅模様 */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-10 pointer-events-none"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(212,175,55,0.4) 1px, transparent 1px)',
          backgroundSize: '12px 12px',
        }}
      />
      <div className="grid grid-cols-3 gap-2 p-2 relative">
        {mandala.cells.map((cell, i) => {
          const isCenter = i === 4;
          const c = scoreColor(cell.score);
          return (
            <motion.button
              key={cell.id}
              onClick={() => onCellTap?.(i, cell)}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04, type: 'spring', stiffness: 220, damping: 18 }}
              whileTap={{ scale: 0.95 }}
              className={`
                relative aspect-square rounded-2xl ring-1 ${c.ring}
                ${c.bg} ${c.text}
                flex flex-col items-center justify-center p-1.5 text-center
                shadow-md active:shadow-inner overflow-hidden
                ${isCenter ? 'ring-2 animate-glow' : ''}
              `}
            >
              <div className={`text-[10px] leading-tight font-medium ${isCenter ? 'opacity-90' : 'opacity-80'} line-clamp-2`}>
                {cell.label}
              </div>
              {typeof cell.score === 'number' ? (
                <div className={`mt-0.5 font-bold tabular-nums ${isCenter ? 'text-2xl' : 'text-lg'}`}>
                  {cell.score}
                </div>
              ) : (
                <div className="mt-0.5 text-[10px] opacity-60">—</div>
              )}
              {isCenter && centerSubLabel && (
                <div className="absolute bottom-1 text-[9px] opacity-70">{centerSubLabel}</div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
