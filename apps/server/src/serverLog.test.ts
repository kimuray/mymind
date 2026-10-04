import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, REDACTED } from './logger';
import { createServerLogFile } from './serverLog';

let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mymind-server-log-'));
  dir = join(root, 'logs', 'server');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** 日本時間の日時を UTC の Date にする */
const jst = (day: string, time: string) => new Date(`${day}T${time}:00+09:00`);

describe('NFR-24 サーバーのログをファイルに残す', () => {
  it('日本時間の日付ごとのファイルに、JSON の1行ずつ追記する', () => {
    let now = jst('2026-10-05', '23:59');
    const file = createServerLogFile({ dir, now: () => now, timeZone: 'Asia/Tokyo' });
    const logger = createLogger({ write: file.write, now: () => now });
    logger.info('起動しました');
    logger.warn('遅い応答', { ms: 1200 });
    now = jst('2026-10-06', '00:00');
    logger.error('失敗しました');

    expect(readdirSync(dir).sort()).toEqual(['2026-10-05.log', '2026-10-06.log']);
    const lines = readFileSync(join(dir, '2026-10-05.log'), 'utf8').trimEnd().split('\n');
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { at: '2026-10-05T14:59:00.000Z', level: 'info', message: '起動しました' },
      { at: '2026-10-05T14:59:00.000Z', level: 'warn', message: '遅い応答', ms: 1200 },
    ]);
  });

  it('ディレクトリは 700、ファイルは 600 で作る（ADR-0009）', () => {
    const file = createServerLogFile({
      dir,
      now: () => jst('2026-10-05', '12:00'),
      timeZone: 'Asia/Tokyo',
    });
    file.write('{}');
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, '2026-10-05.log')).mode & 0o777).toBe(0o600);
  });

  it('機微データの項目は、ファイルにも伏せ字で残す（NFR-16）', () => {
    const file = createServerLogFile({
      dir,
      now: () => jst('2026-10-05', '12:00'),
      timeZone: 'Asia/Tokyo',
    });
    createLogger({ write: file.write }).info('保存しました', { thoughtsMd: '誰にも見せない' });
    const text = readFileSync(join(dir, '2026-10-05.log'), 'utf8');
    expect(text).not.toContain('誰にも見せない');
    expect(JSON.parse(text)).toMatchObject({ thoughtsMd: REDACTED });
  });

  it('最初に書くときと日付が変わったときに、14日を過ぎたファイルを消す', () => {
    mkdirSync(dir, { recursive: true });
    for (const name of ['2026-09-20.log', '2026-09-21.log', '2026-09-22.log', 'メモ.txt']) {
      writeFileSync(join(dir, name), '');
    }
    let now = jst('2026-10-05', '12:00');
    const file = createServerLogFile({ dir, now: () => now, timeZone: 'Asia/Tokyo' });
    file.write('{}');
    // 10月5日から14日前（9月21日）より前のファイルを消す
    expect(readdirSync(dir).sort()).toEqual([
      '2026-09-21.log',
      '2026-09-22.log',
      '2026-10-05.log',
      'メモ.txt',
    ]);
    now = jst('2026-10-06', '00:01');
    file.write('{}');
    expect(readdirSync(dir).sort()).toEqual([
      '2026-09-22.log',
      '2026-10-05.log',
      '2026-10-06.log',
      'メモ.txt',
    ]);
  });

  it('書けなくても例外にせず、知らせて続ける', () => {
    // ディレクトリを置くはずの場所にファイルがあると、ディレクトリを作れない
    mkdirSync(join(root, 'logs'));
    writeFileSync(dir, '');
    const errors: unknown[] = [];
    const file = createServerLogFile({
      dir,
      now: () => jst('2026-10-05', '12:00'),
      timeZone: 'Asia/Tokyo',
      onError: (e) => errors.push(e),
    });
    expect(() => file.write('{}')).not.toThrow();
    expect(errors).toHaveLength(1);
  });
});
