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
