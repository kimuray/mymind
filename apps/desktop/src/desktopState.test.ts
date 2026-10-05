import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readDesktopState,
  shouldEnableLoginItemOnFirstRun,
  writeDesktopState,
} from './desktopState';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mymind-desktop-state-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('NFR-27 ログイン時の起動の初期値', () => {
  it('.app で、状態のファイルがまだないとき（初めての起動）だけオンにする', () => {
    const fresh = readDesktopState(join(dir, 'missing.json'));
    expect(fresh).toEqual({ kind: 'missing' });
    expect(shouldEnableLoginItemOnFirstRun({ isPackaged: true, read: fresh })).toBe(true);
    expect(
      shouldEnableLoginItemOnFirstRun({
        isPackaged: true,
        read: { kind: 'ok', state: { loginItemInitialized: true } },
      }),
    ).toBe(false);
  });

  it('開発時の起動（.app でない）ではオンにしない', () => {
    expect(shouldEnableLoginItemOnFirstRun({ isPackaged: false, read: { kind: 'missing' } })).toBe(
      false,
    );
  });

  it('一度オンにしたことを本人だけが読めるファイルに残し、次の起動で読み戻す', () => {
    const path = join(dir, 'desktop-state.json');
    writeDesktopState(path, { loginItemInitialized: true });
    expect(readDesktopState(path)).toEqual({ kind: 'ok', state: { loginItemInitialized: true } });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ loginItemInitialized: true });
  });

  it('オフにしたあとで状態のファイルが壊れても、オンに戻さない', () => {
    const path = join(dir, 'desktop-state.json');
    writeFileSync(path, '{ 壊れた');
    const read = readDesktopState(path);
    expect(read.kind).toBe('invalid');
    expect(shouldEnableLoginItemOnFirstRun({ isPackaged: true, read })).toBe(false);
  });

  it('形の違う状態のファイルも、読めないものとして扱う', () => {
    const path = join(dir, 'desktop-state.json');
    writeFileSync(path, JSON.stringify({ loginItemInitialized: 'yes' }));
    expect(readDesktopState(path)).toEqual({ kind: 'invalid', reason: '形が正しくありません' });
  });
});
