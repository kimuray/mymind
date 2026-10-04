import { describe, expect, it } from 'vitest';
import {
  composeEvening,
  composeInventory,
  composeMorning,
  DEFAULT_NOTIFICATION_SCHEDULES,
} from './notifications';

describe('FR-N01 朝の通知', () => {
  it('計画が未確定なら、昨日の FB と持ち越しの件数を書いて送る', () => {
    expect(
      composeMorning({ isPlanConfirmed: false, hasYesterdayFeedback: true, carryoverCount: 3 }),
    ).toEqual({
      kind: 'morning',
      title: '朝の計画',
      body: '昨日のFBが届いています。持ち越しが3件あります',
      path: '/morning',
    });
  });

  it('計画を確定していれば送らない', () => {
    expect(
      composeMorning({ isPlanConfirmed: true, hasYesterdayFeedback: true, carryoverCount: 3 }),
    ).toBeNull();
  });

  it('FB がなく持ち越しもなければ、計画を促す文にする', () => {
    expect(
      composeMorning({ isPlanConfirmed: false, hasYesterdayFeedback: false, carryoverCount: 0 })
        ?.body,
    ).toBe('今日の計画を立てましょう');
  });

  it('持ち越しだけなら、件数だけを書く', () => {
    expect(
      composeMorning({ isPlanConfirmed: false, hasYesterdayFeedback: false, carryoverCount: 1 })
        ?.body,
    ).toBe('持ち越しが1件あります');
  });

  it('初期値は毎日 8:30', () => {
    expect(DEFAULT_NOTIFICATION_SCHEDULES.morning).toEqual({ time: '08:30' });
  });
});

describe('FR-N02 夜の通知', () => {
  it('振り返りが未保存なら、完了件数といちばん長引いているタスクを書いて送る', () => {
    expect(
      composeEvening({
        isReflectionSaved: false,
        completedCount: 3,
        lingering: [
          { title: '請求書', status: 'doing', dayOrdinal: 3 },
          { title: '競合調査', status: 'waiting', dayOrdinal: 5 },
        ],
      }),
    ).toEqual({
      kind: 'evening',
      title: '振り返り',
      body: '今日は3件完了。競合調査が待ちのまま5日目です',
      path: '/reflection',
    });
  });

  it('振り返りを保存していれば送らない', () => {
    expect(
      composeEvening({ isReflectionSaved: true, completedCount: 3, lingering: [] }),
    ).toBeNull();
  });

  it('着手中のタスクが長引いていれば、着手して何日目かを書く', () => {
    expect(
      composeEvening({
        isReflectionSaved: false,
        completedCount: 0,
        lingering: [{ title: '設計書', status: 'doing', dayOrdinal: 4 }],
      })?.body,
    ).toBe('設計書に着手して4日目です');
  });

  it('完了も長引いているタスクもなければ、振り返りを促す文にする', () => {
    expect(
      composeEvening({ isReflectionSaved: false, completedCount: 0, lingering: [] })?.body,
    ).toBe('今日の振り返りを書きましょう');
  });

  it('長いタスク名は20文字で縮める', () => {
    const title = 'あ'.repeat(25);
    expect(
      composeEvening({
        isReflectionSaved: false,
        completedCount: 1,
        lingering: [{ title, status: 'waiting', dayOrdinal: 3 }],
      })?.body,
    ).toBe(`今日は1件完了。${'あ'.repeat(20)}…が待ちのまま3日目です`);
  });

  it('初期値は毎日 21:30', () => {
    expect(DEFAULT_NOTIFICATION_SCHEDULES.evening).toEqual({ time: '21:30' });
  });
});

describe('FR-N03 棚卸しの通知', () => {
  it('対象があれば、設定の日数と件数を書いて送る', () => {
    expect(composeInventory({ targetCount: 4, afterDays: 30 })).toEqual({
      kind: 'inventory',
      title: '棚卸し',
      body: '30日以上触れていないタスクが4件あります',
      path: '/backlog',
    });
  });

  it('対象がなければ送らない', () => {
    expect(composeInventory({ targetCount: 0, afterDays: 30 })).toBeNull();
  });

  it('日数が0（すべてが対象）なら、「触れていない」と書かない', () => {
    expect(composeInventory({ targetCount: 2, afterDays: 0 })?.body).toBe(
      '棚卸しの対象が2件あります',
    );
  });

  it('初期値は日曜の 21:45', () => {
    expect(DEFAULT_NOTIFICATION_SCHEDULES.inventory).toEqual({ time: '21:45', weekday: 0 });
  });
});
