import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireLock, ensureDataDir, issueSessionToken } from './dataDir';

let root: string;
let dataDir: string;
const mode = (path: string) => statSync(path).mode & 0o777;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mymind-server-'));
  dataDir = join(root, 'data');
  ensureDataDir(dataDir);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('NFR-02 セッショントークン', () => {
  it('データディレクトリを本人だけが読めるようにする', () => {
    expect(mode(dataDir)).toBe(0o700);
  });

  it('トークンを本人だけが読めるファイルに書き出す', () => {
    const token = issueSessionToken(dataDir);
    const path = join(dataDir, 'session-token');
    expect(readFileSync(path, 'utf8')).toBe(token);
    expect(mode(path)).toBe(0o600);
  });

  it('起動ごとに別のトークンを作る', () => {
    expect(issueSessionToken(dataDir)).not.toBe(issueSessionToken(dataDir));
  });
});

describe('NFR-20 二重起動の防止', () => {
  const lockPath = () => join(dataDir, 'mymind.lock');
  // テストを実行しているプロセス自身は必ず生きているので、動いているサーバーの代わりに使う
  const alivePid = process.pid;
  const otherPid = process.pid + 1_000_000;

  it('ロックがなければ取得し、PID を書き込む', () => {
    expect(acquireLock(dataDir, otherPid)).toMatchObject({ ok: true });
    expect(readFileSync(lockPath(), 'utf8')).toBe(String(otherPid));
  });

  it('生きているプロセスがロックを持っていれば失敗を返す', () => {
    acquireLock(dataDir, alivePid);
    expect(acquireLock(dataDir, otherPid)).toEqual({
      ok: false,
      error: { kind: 'already_running', pid: alivePid },
    });
  });

  it('異常終了で残ったロックは引き継ぐ', () => {
    writeFileSync(lockPath(), String(otherPid));
    expect(acquireLock(dataDir, alivePid)).toMatchObject({ ok: true });
    expect(readFileSync(lockPath(), 'utf8')).toBe(String(alivePid));
  });

  it('中身が壊れたロックは引き継ぐ', () => {
    writeFileSync(lockPath(), 'not-a-pid');
    expect(acquireLock(dataDir, alivePid)).toMatchObject({ ok: true });
  });

  it('終了時にロックを消し、次のサーバーが起動できる', () => {
    const first = acquireLock(dataDir, alivePid);
    if (!first.ok) throw new Error('ロックを取得できませんでした');
    first.release();
    expect(existsSync(lockPath())).toBe(false);
    expect(acquireLock(dataDir, otherPid)).toMatchObject({ ok: true });
  });

  it('別のプロセスに引き継がれたロックは消さない', () => {
    const first = acquireLock(dataDir, otherPid);
    if (!first.ok) throw new Error('ロックを取得できませんでした');
    writeFileSync(lockPath(), String(alivePid));
    first.release();
    expect(readFileSync(lockPath(), 'utf8')).toBe(String(alivePid));
  });
});
