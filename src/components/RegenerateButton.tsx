'use client';

/**
 * 「データ再生成」ボタン: GitHub Actions の Daily Mandala Refresh を
 * workflow_dispatch で起動するためのトリガー UI。
 *
 * 動作:
 *  - 押すとパスワード入力モーダルを表示
 *  - 入力 → /api/refresh-trigger に POST
 *  - 成功: トースト「ワークフロー起動しました」+ クールダウン開始
 *  - クールダウン中: 残り時間表示
 *
 * 使い方:
 *  ```tsx
 *  <RegenerateButton />
 *  ```
 */

import { useEffect, useState } from 'react';
import { Rocket, Loader2, Lock, X, Check, AlertTriangle } from 'lucide-react';

type Status =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'success'; nextAvailableAt: string }
  | { kind: 'cooldown'; remainingSec: number; lastDispatchedAt?: string }
  | { kind: 'error'; message: string };

interface AvailabilityResp {
  available: boolean;
  remainingSec?: number;
  lastDispatchedAt?: string;
  cooldownSec?: number;
  kvEnabled?: boolean;
}

function formatRemaining(sec: number): string {
  if (sec <= 0) return '間もなく利用可能';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `あと ${h}時間 ${m}分`;
  if (m > 0) return `あと ${m}分`;
  return `あと ${sec}秒`;
}

export default function RegenerateButton() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  // 起動時: 最後の実行時刻を確認してクールダウン状態を反映
  useEffect(() => {
    let cancelled = false;
    fetch('/api/refresh-trigger')
      .then((r) => r.json() as Promise<AvailabilityResp>)
      .then((j) => {
        if (cancelled) return;
        if (!j.available && j.remainingSec) {
          setStatus({
            kind: 'cooldown',
            remainingSec: j.remainingSec,
            lastDispatchedAt: j.lastDispatchedAt,
          });
        }
      })
      .catch(() => {
        // 取得失敗時はそのまま idle のまま（ボタンは押せる）
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // クールダウン中はカウントダウンで残り時間更新
  useEffect(() => {
    if (status.kind !== 'cooldown') return;
    const id = setInterval(() => {
      setStatus((s) => {
        if (s.kind !== 'cooldown') return s;
        const remaining = s.remainingSec - 1;
        if (remaining <= 0) return { kind: 'idle' };
        return { ...s, remainingSec: remaining };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [status.kind]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setStatus({ kind: 'loading' });
    try {
      const r = await fetch('/api/refresh-trigger', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const j = await r.json();
      if (r.ok) {
        setStatus({ kind: 'success', nextAvailableAt: j.nextAvailableAt });
        setOpen(false);
        setPassword('');
        // 5 秒後にクールダウン表示へ
        setTimeout(() => {
          const remainingSec = Math.max(
            0,
            Math.floor((new Date(j.nextAvailableAt).getTime() - Date.now()) / 1000),
          );
          setStatus({
            kind: 'cooldown',
            remainingSec,
            lastDispatchedAt: j.dispatchedAt,
          });
        }, 5000);
      } else if (r.status === 429) {
        setStatus({
          kind: 'cooldown',
          remainingSec: j.remainingSec ?? 0,
          lastDispatchedAt: j.lastDispatchedAt,
        });
        setOpen(false);
      } else {
        setStatus({ kind: 'error', message: j.error || `HTTP ${r.status}` });
      }
    } catch (e) {
      setStatus({ kind: 'error', message: (e as Error).message });
    }
  };

  // ボタン表示
  const isDisabled = status.kind === 'loading' || status.kind === 'cooldown';

  return (
    <>
      <button
        onClick={() => {
          if (isDisabled) return;
          setStatus({ kind: 'idle' });
          setOpen(true);
        }}
        disabled={isDisabled}
        className={`text-xs px-3 py-1.5 rounded-full ring-1 transition flex items-center gap-1.5 shrink-0 ${
          status.kind === 'cooldown'
            ? 'bg-ink-900 ring-ink-800 text-slate-500 cursor-not-allowed'
            : status.kind === 'loading'
              ? 'bg-gold/20 ring-gold/40 text-gold-light cursor-wait'
              : 'bg-ink-900 ring-gold/40 text-gold-light hover:bg-gold/10'
        }`}
        title={
          status.kind === 'cooldown'
            ? `クールダウン中（${formatRemaining(status.remainingSec)}）`
            : 'GitHub Actions ワークフローを起動'
        }
      >
        {status.kind === 'loading' ? (
          <>
            <Loader2 size={12} className="animate-spin" />
            <span>起動中…</span>
          </>
        ) : status.kind === 'cooldown' ? (
          <>
            <Lock size={12} />
            <span>{formatRemaining(status.remainingSec)}</span>
          </>
        ) : (
          <>
            <Rocket size={12} />
            <span>データ再生成</span>
          </>
        )}
      </button>

      {/* 成功トースト */}
      {status.kind === 'success' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-jade-dark/90 ring-1 ring-jade/50 rounded-2xl px-4 py-3 text-sm text-white shadow-lg flex items-center gap-2 max-w-xs">
          <Check size={16} className="text-jade-light shrink-0" />
          <div>
            <div className="font-bold">ワークフロー起動完了</div>
            <div className="text-[11px] text-jade-light/80 mt-0.5">
              データ反映まで約 2 時間かかります。次の起動は 6 時間後から可能。
            </div>
          </div>
        </div>
      )}

      {/* エラートースト */}
      {status.kind === 'error' && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-red-950/90 ring-1 ring-red-500/50 rounded-2xl px-4 py-3 text-sm text-white shadow-lg flex items-start gap-2 max-w-xs">
          <AlertTriangle size={16} className="text-red-300 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold">エラー</div>
            <div className="text-[11px] text-red-200 mt-0.5 break-all">{status.message}</div>
          </div>
          <button
            onClick={() => setStatus({ kind: 'idle' })}
            className="text-red-300 hover:text-white"
            aria-label="閉じる"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* パスワード入力モーダル */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={onSubmit}
            className="bg-ink-900 ring-1 ring-gold/30 rounded-2xl p-5 w-full max-w-xs shadow-2xl"
          >
            <div className="flex items-center gap-2 mb-3">
              <Rocket size={16} className="text-gold-light" />
              <h2 className="text-sm font-bold text-white">データ再生成</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="ml-auto text-slate-500 hover:text-white"
                aria-label="閉じる"
              >
                <X size={16} />
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
              GitHub Actions の{' '}
              <code className="text-gold-light bg-ink-950 px-1 rounded">refresh.yml</code>{' '}
              ワークフローを起動します。約 2 時間で全銘柄のデータが更新されます。
            </p>
            <input
              type="password"
              autoFocus
              placeholder="管理者パスワード"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-ink-950 ring-1 ring-ink-800 focus:ring-gold/50 rounded-lg px-3 py-2 text-sm text-white outline-none"
            />
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-ink-800 text-slate-300 hover:bg-ink-700"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={!password}
                className="flex-1 text-xs px-3 py-2 rounded-lg bg-gradient-to-r from-gold to-gold-dark text-ink-950 font-bold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                起動
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
