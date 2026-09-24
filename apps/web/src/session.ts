// セッショントークン（ADR-0007）。サーバー（本番）か Vite のプラグイン（開発）が index.html の meta タグに埋め込む

export const TOKEN_HEADER = 'X-Mymind-Token';

/** 状態を変えるリクエストに付けるトークン。埋め込まれていなければ null（サーバーは 403 を返す） */
export function readSessionToken(doc: Pick<Document, 'querySelector'> = document): string | null {
  return doc.querySelector('meta[name="mymind-token"]')?.getAttribute('content') ?? null;
}
