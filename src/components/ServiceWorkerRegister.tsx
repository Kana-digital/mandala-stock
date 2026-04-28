'use client';

import { useEffect } from 'react';

/**
 * Service Worker をブラウザ起動時に登録するクライアントコンポーネント。
 * - 開発モード（localhost）でも動くが、HTTPS でないとブラウザによっては
 *   インストール扱いにならないので注意。
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    // ページロード後、idle 中に登録（メインスレッドを邪魔しない）
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => {
        console.warn('SW registration failed:', err);
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
