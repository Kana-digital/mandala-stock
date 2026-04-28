import { NextResponse, type NextRequest } from 'next/server';

/**
 * Vercel Edge Middleware による Basic 認証。
 * 環境変数：
 *   BASIC_AUTH_USER … 任意のユーザー名
 *   BASIC_AUTH_PASS … 任意のパスフレーズ
 * Vercel ダッシュボードの Settings → Environment Variables に設定すること。
 */
export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // 環境変数未設定時はスルー（ローカル開発用）
  if (!user || !pass) {
    return NextResponse.next();
  }

  const auth = req.headers.get('authorization');
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const [u, p] = decoded.split(':');
      if (u === user && p === pass) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Mandala Stock"' },
  });
}

export const config = {
  // 静的アセットと PWA 必須ファイル、Cron ルートは認証スキップ
  // (/api/cron は Vercel Cron の Bearer 認証を使うため除外)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|splash/|sw.js|api/cron/).*)'],
};
