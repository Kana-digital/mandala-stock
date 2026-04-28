'use client';

import { useEffect, useState } from 'react';

interface Props {
  trigger: number; // この値が変わるたびにコンフェッティ発射
  count?: number;
}

const COLORS = ['#D4AF37', '#FFE17A', '#10B981', '#A78BFA', '#F472B6', '#60A5FA'];

interface Piece {
  id: string;
  left: number;       // 0-100 (vw %)
  cx: number;         // 横方向のドリフト px
  delay: number;
  duration: number;
  color: string;
  rot: number;
}

/**
 * 高スコア達成などのお祝い時に画面上から紙吹雪が降ってくる
 */
export default function Confetti({ trigger, count = 60 }: Props) {
  const [pieces, setPieces] = useState<Piece[]>([]);

  useEffect(() => {
    if (!trigger) return;
    const next: Piece[] = Array.from({ length: count }).map((_, i) => ({
      id: `${trigger}-${i}`,
      left: Math.random() * 100,
      cx: (Math.random() - 0.5) * 240,
      delay: Math.random() * 0.4,
      duration: 2.2 + Math.random() * 1.6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rot: Math.random() * 360,
    }));
    setPieces(next);
    const t = setTimeout(() => setPieces([]), 4500);
    return () => clearTimeout(t);
  }, [trigger, count]);

  if (pieces.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={{
            left: `${p.left}vw`,
            background: p.color,
            transform: `rotate(${p.rot}deg)`,
            animationDelay: `${p.delay}s`,
            ['--cx' as never]: `${p.cx}px`,
            ['--dur' as never]: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
