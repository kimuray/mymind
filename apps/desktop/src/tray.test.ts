import { describe, expect, it } from 'vitest';
import { buildTrayMenu, buildUpdateItems } from './tray';
import type { UpdateState } from './updater';

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

describe('FR-U05 メニューバーのアップデートの項目', () => {
  const noop = () => {};
  const labels = (state: UpdateState) =>
    buildTrayMenu({
      open: noop,
      openPath: noop,
      quit: noop,
      update: { state, check: noop, apply: noop, openLog: noop },
    }).map((item) => ('label' in item ? item.label : '---'));

  it('終了の前に、区切りを挟んでアップデートの項目を出す', () => {
    expect(labels({ kind: 'idle' }).slice(-3)).toEqual([
      'アップデートを確認',
      '---',
      'mymind を終了',
    ]);
  });

  it('アップデートがあるときは、変更の件数を出し、選ぶと適用を呼ぶ', () => {
    const calls: string[] = [];
    const items = buildUpdateItems({
      state: { kind: 'available', latest: 'a'.repeat(40), commits: 3 },
      check: noop,
      apply: () => calls.push('apply'),
      openLog: noop,
    });
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item && 'label' in item ? item.label : '').toBe('アップデートがあります（3 件の変更）…');
    if (item && 'click' in item) item.click();
    expect(calls).toEqual(['apply']);
  });

  it('確認中と更新中は、選べない項目にする', () => {
    for (const kind of ['checking', 'updating'] as const) {
      const [item] = buildUpdateItems({ state: { kind }, check: noop, apply: noop, openLog: noop });
      expect(item && 'enabled' in item ? item.enabled : true).toBe(false);
    }
  });

  it('失敗したときは、ログを開く項目と、確かめ直す項目を出す', () => {
    expect(labels({ kind: 'failed', message: '失敗' })).toContain(
      'アップデートに失敗しました（ログを開く）',
    );
    expect(labels({ kind: 'failed', message: '失敗' })).toContain('アップデートを確認');
  });
});
