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
  it('.app の初めての起動でだけオンにする', () => {
    const fresh = readDesktopState(join(dir, 'missing.json'));
    expect(shouldEnableLoginItemOnFirstRun({ isPackaged: true, state: fresh })).toBe(true);
    expect(
      shouldEnableLoginItemOnFirstRun({ isPackaged: true, state: { loginItemInitialized: true } }),
    ).toBe(false);
  });

  it('開発時の起動（.app でない）ではオンにしない', () => {
    expect(
      shouldEnableLoginItemOnFirstRun({
        isPackaged: false,
        state: { loginItemInitialized: false },
      }),
    ).toBe(false);
  });

  it('一度オンにしたことを本人だけが読めるファイルに残し、次の起動で読み戻す', () => {
    const path = join(dir, 'desktop-state.json');
    writeDesktopState(path, { loginItemInitialized: true });
    expect(readDesktopState(path)).toEqual({ loginItemInitialized: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ loginItemInitialized: true });
  });

  it('壊れたファイルは、初めての起動として扱う', () => {
    const path = join(dir, 'desktop-state.json');
    writeFileSync(path, '{ 壊れた');
    expect(readDesktopState(path)).toEqual({ loginItemInitialized: false });
  });
});
