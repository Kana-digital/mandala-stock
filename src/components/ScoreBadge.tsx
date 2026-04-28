'use client';

import { judgement, judgementLabel, scoreColor } from '@/domain/scoring';
import type { Score } from '@/domain/types';
import AnimatedNumber from './AnimatedNumber';

interface Props {
  score: Score | undefined;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** カウントアップアニメーションを無効化したいとき (リスト表示用) */
  static?: boolean;
  /** スコア80以上で常に発光 */
  glow?: boolean;
}

/**
 * スコアを華やかに見せる豪華バッジ。
 * - 80+ : 金グラデ + 常時グロー (買い)
 * - 60-79 : 翡翠グラデ (中立)
 * - 40-59 : スレート (見送り低)
 * - <40 : 紫×朱 (見送り)
 * lg/xl サイズではカウントアップアニメ + シャイン演出
 */
export default function ScoreBadge({ score, size = 'md', static: isStatic = false, glow = true }: Props) {
  const j = judgement(score);
  const c = scoreColor(score);
  const isHigh = typeof score === 'number' && score >= 80;
  const isMid = typeof score === 'number' && score >= 60 && score < 80;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-sm px-3 py-1 gap-1.5',
    lg: 'text-lg px-4 py-1.5 gap-2',
    xl: 'text-3xl px-5 py-2.5 gap-3 font-extrabold tracking-tight',
  }[size];

  const showAnimation = !isStatic && (size === 'lg' || size === 'xl');

  return (
    <span
      className={[
        'relative inline-flex items-center rounded-full font-bold ring-1 overflow-hidden',
        c.bg,
        c.text,
        c.ring,
        sizeClasses,
        isHigh && glow ? 'animate-glow-pulse' : '',
        size === 'xl' || size === 'lg' ? 'shine' : '',
        isHigh && (size === 'xl' || size === 'lg') ? 'animate-pop-in' : '',
      ].join(' ')}
    >
      {/* 高スコア時の星アイコン */}
      {isHigh && (size === 'lg' || size === 'xl') && (
        <span aria-hidden className="text-yellow-200 animate-sparkle">★</span>
      )}
      <span className="tabular-nums relative z-10">
        {typeof score === 'number' ? (
          showAnimation ? <AnimatedNumber value={score} duration={1200} decimals={0} /> : score
        ) : '—'}
      </span>
      <span className="opacity-80 relative z-10">{judgementLabel(j)}</span>
      {/* 中スコアのキラ */}
      {isMid && (size === 'lg' || size === 'xl') && (
        <span aria-hidden className="text-jade-light/80">✦</span>
      )}
    </span>
  );
}
