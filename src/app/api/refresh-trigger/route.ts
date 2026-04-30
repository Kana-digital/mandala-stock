import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/cache';
import { kvGet, kvSet, isKvEnabled } from '@/lib/clients/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GitHub Actions の `Daily Mandala Refresh` ワークフローを workflow_dispatch で起動する。
 *
 * 必要な環境変数:
 *   - GITHUB_TOKEN  : `workflow` スコープを持つ Personal Access Token
 *   - GITHUB_OWNER  : 既定 'Kana-digital'
 *   - GITHUB_REPO   : 既定 'mandala-stock'
 *   - GITHUB_REF    : 既定 'main'
 *   - ADMIN_PASSWORD: 簡易認証パスワード（クライアントから送信）
 *
 * 暴走防止:
 *   - クールダウン（既定 6 時間）を Upstash KV に保存し、その間は 429 を返す
 *
 * リクエスト形式:
 *   POST /api/refresh-trigger
 *   { "password": "..." }
 *
 * レスポンス:
 *   200 { ok: true, dispatchedAt, nextAvailableAt }
 *   401 { error: 'invalid password' }
 *   429 { error: 'cooldown', remainingSec }
 *   500 { error: '...' }
 */

const COOLDOWN_KEY = 'meta:refresh-trigger:last';
// 既定クールダウン: 6 時間
const DEFAULT_COOLDOWN_SEC = 6 * 60 * 60;

interface CooldownState {
  lastDispatchedAt: string;
  triggeredBy: 'web';
}

function envOrDefault(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export async function POST(req: NextRequest) {
  // ---------- 1. 環境変数チェック ----------
  const adminPassword = process.env.ADMIN_PASSWORD;
  const githubToken = process.env.GITHUB_TOKEN;
  if (!adminPassword) {
    return errorResponse('ADMIN_PASSWORD is not configured on the server', 500);
  }
  if (!githubToken) {
    return errorResponse('GITHUB_TOKEN is not configured on the server', 500);
  }

  // ---------- 2. リクエスト body のパース ----------
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('invalid JSON body', 400);
  }
  if (!body.password || typeof body.password !== 'string') {
    return errorResponse('password is required', 400);
  }

  // ---------- 3. パスワード検証（タイミング攻撃防止のため定数時間比較） ----------
  if (!constantTimeEquals(body.password, adminPassword)) {
    return errorResponse('invalid password', 401);
  }

  // ---------- 4. クールダウン確認 ----------
  const cooldownSec = Number(process.env.REFRESH_COOLDOWN_SEC ?? DEFAULT_COOLDOWN_SEC);
  if (isKvEnabled()) {
    try {
      const last = await kvGet<CooldownState>(COOLDOWN_KEY);
      if (last?.lastDispatchedAt) {
        const lastMs = new Date(last.lastDispatchedAt).getTime();
        const nowMs = Date.now();
        const elapsedSec = (nowMs - lastMs) / 1000;
        if (elapsedSec < cooldownSec) {
          const remainingSec = Math.ceil(cooldownSec - elapsedSec);
          return jsonResponse(
            {
              error: 'cooldown',
              remainingSec,
              lastDispatchedAt: last.lastDispatchedAt,
              cooldownSec,
            },
            { status: 429, sMaxAge: 0 },
          );
        }
      }
    } catch (e) {
      // KV エラーでもブロックしない（ベストエフォート）
      console.warn('[refresh-trigger] KV lookup failed:', (e as Error).message);
    }
  }

  // ---------- 5. GitHub API で workflow_dispatch ----------
  const owner = envOrDefault('GITHUB_OWNER', 'Kana-digital');
  const repo = envOrDefault('GITHUB_REPO', 'mandala-stock');
  const ref = envOrDefault('GITHUB_REF', 'main');
  const workflowFile = 'refresh.yml';
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowFile}/dispatches`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    });
  } catch (e) {
    return errorResponse(`github fetch failed: ${(e as Error).message}`, 502);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return errorResponse(
      `github dispatch failed: ${res.status} ${text.slice(0, 300)}`,
      res.status === 401 || res.status === 403 ? 502 : 500,
    );
  }

  // ---------- 6. クールダウン記録 ----------
  const dispatchedAt = new Date().toISOString();
  if (isKvEnabled()) {
    try {
      await kvSet<CooldownState>(
        COOLDOWN_KEY,
        { lastDispatchedAt: dispatchedAt, triggeredBy: 'web' },
        cooldownSec + 60,
      );
    } catch (e) {
      console.warn('[refresh-trigger] KV write failed:', (e as Error).message);
    }
  }

  const nextAvailableAt = new Date(Date.now() + cooldownSec * 1000).toISOString();
  return jsonResponse(
    {
      ok: true,
      dispatchedAt,
      nextAvailableAt,
      cooldownSec,
      workflow: workflowFile,
      ref,
    },
    { sMaxAge: 0 },
  );
}

/**
 * GET でクールダウン状況だけ返す（ボタンの押せる/押せない判定用）。
 * パスワード不要だが、最後の起動時刻のみ返すので情報漏洩なし。
 */
export async function GET() {
  if (!isKvEnabled()) {
    return jsonResponse({ available: true, kvEnabled: false }, { sMaxAge: 0 });
  }
  const cooldownSec = Number(process.env.REFRESH_COOLDOWN_SEC ?? DEFAULT_COOLDOWN_SEC);
  try {
    const last = await kvGet<CooldownState>(COOLDOWN_KEY);
    if (!last?.lastDispatchedAt) {
      return jsonResponse({ available: true, cooldownSec }, { sMaxAge: 0 });
    }
    const lastMs = new Date(last.lastDispatchedAt).getTime();
    const elapsedSec = (Date.now() - lastMs) / 1000;
    if (elapsedSec >= cooldownSec) {
      return jsonResponse(
        {
          available: true,
          lastDispatchedAt: last.lastDispatchedAt,
          cooldownSec,
        },
        { sMaxAge: 0 },
      );
    }
    return jsonResponse(
      {
        available: false,
        lastDispatchedAt: last.lastDispatchedAt,
        remainingSec: Math.ceil(cooldownSec - elapsedSec),
        cooldownSec,
      },
      { sMaxAge: 0 },
    );
  } catch (e) {
    return errorResponse(`status lookup failed: ${(e as Error).message}`, 500);
  }
}

/** タイミング攻撃を避けるための定数時間文字列比較 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
