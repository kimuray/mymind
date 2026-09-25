import { chmodSync, existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export type SnapshotError = { kind: 'destination_exists'; path: string };

/**
 * DB 全体を1つのファイルに書き出す（NFR-04）。
 * VACUUM INTO は書き込み中でも一貫した内容を書き出せ、WAL の内容も含むので、ファイルのコピーより安全。
 * 書き出し先が既にあると SQLite が失敗するため、先に確かめて意味のある失敗として返す。
 */
export function writeSnapshot(
  client: DatabaseSync,
  destinationPath: string,
): { ok: true } | { ok: false; error: SnapshotError } {
  if (existsSync(destinationPath)) {
    return { ok: false, error: { kind: 'destination_exists', path: destinationPath } };
  }
  client.prepare('VACUUM INTO ?').run(destinationPath);
  // スナップショットも DB と同じ機微データを含むので、本人だけが読めるようにする（ADR-0009）
  chmodSync(destinationPath, 0o600);
  return { ok: true };
}
