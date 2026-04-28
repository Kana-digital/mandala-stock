'use client';

import { useEffect, useState, useRef } from 'react';

interface Props {
  value: number;
  duration?: number;          // ミリ秒
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}

/**
 * 数字をスムーズにカウントアップ表示するコンポーネント
 * easeOutCubic で減速しながら最終値に到達
 */
export default function AnimatedNumber({
  value,
  duration = 1100,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}: Props) {
  const [display, setDisplay] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const startValueRef = useRef(0);
  const targetRef = useRef(value);

  useEffect(() => {
    startValueRef.current = display;
    targetRef.current = value;
    startTimeRef.current = null;

    let raf = 0;
    const step = (now: number) => {
      if (startTimeRef.current === null) startTimeRef.current = now;
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = startValueRef.current + (targetRef.current - startValueRef.current) * eased;
      setDisplay(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  const formatted = display.toFixed(decimals);
  return (
    <span className={className}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
