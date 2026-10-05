/**
 * ウィンドウの中で開いてよい URL か（ADR-0015）。サーバーと同じオリジン（開発時は Vite も）だけを許し、
 * ほかの URL へは移らせない
 */
export function isAppUrl(url: string, allowedOrigins: readonly string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // URL として読めないものは、開いてよい URL ではない
    return false;
  }
  return allowedOrigins.includes(parsed.origin);
}

/** 既定のブラウザで開いてよい外部の URL か。http と https だけを許す（file: やアプリのスキームは開かない） */
export function isExternalWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * サーバーが知らせた待ち受けの URL が、起動したときに決めたもの（http://127.0.0.1:<ポート>）と同じか。
 * 違う URL は開かない（ウィンドウとアプリの画面からの依頼を許すオリジンになるため、ADR-0007）
 */
export function isExpectedServerUrl(url: string, port: number): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === `http://127.0.0.1:${port}` &&
      (parsed.pathname === '/' || parsed.pathname === '')
    );
  } catch {
    return false;
  }
}

/** サーバーを待ち受けさせるポート。MYMIND_PORT がなければ 4820（サーバーの既定と同じ） */
export function serverPort(env: Record<string, string | undefined>): number {
  const port = Number(env['MYMIND_PORT'] ?? 4820);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 4820;
}
