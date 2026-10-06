import { describe, expect, it } from 'vitest';
import { buildTrayMenu } from './tray';

describe('NFR-27 メニューバーのメニュー', () => {
  it('開く、今日・朝の計画・振り返り、終了の順に並べ、それぞれの操作を呼ぶ', () => {
    const calls: string[] = [];
    const menu = buildTrayMenu({
      open: () => calls.push('open'),
      openPath: (path) => calls.push(`path:${path}`),
      quit: () => calls.push('quit'),
    });
    expect(menu.map((item) => ('label' in item ? item.label : '---'))).toEqual([
      'mymind を開く',
      '---',
      '今日',
      '朝の計画',
      '振り返り',
      '---',
      'mymind を終了',
    ]);
    for (const item of menu) if ('click' in item) item.click();
    expect(calls).toEqual(['open', 'path:/', 'path:/morning', 'path:/reflection', 'quit']);
  });
});
