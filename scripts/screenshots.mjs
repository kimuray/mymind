// 各画面のスクリーンショットを .data/screenshots/ に出力する（#25）。Figma のフレームと並べて見た目を確認するために使う。
// 使い方: pnpm screenshots（先に pnpm build で画面の本番ビルドを作る）
// 実データには触れない：一時的なデータディレクトリでサーバーを起動し、見本のタスクを API で入れてから撮る。
// Chromium は Claude Code のサンドボックスの中では起動できない（Mach ポートの制限。#15）。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('..', import.meta.url).pathname;
const port = Number(process.env.MYMIND_SCREENSHOT_PORT ?? 4840);
const base = `http://127.0.0.1:${port}`;
const dataDir = join(root, '.data/screenshots-server');
const outDir = join(root, '.data/screenshots');
const VIEWPORT = { width: 1440, height: 900 }; // Figma のフレームと同じ大きさ

if (!existsSync(join(root, 'apps/web/dist/index.html'))) {
  console.error('画面の本番ビルドがありません。先に pnpm build を実行してください');
  process.exit(1);
}

rmSync(dataDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const server = spawn('node', ['--import', 'tsx', 'src/main.ts'], {
  cwd: join(root, 'apps/server'),
  env: { ...process.env, MYMIND_DATA_DIR: dataDir, MYMIND_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('起動しました')) resolve();
  });
  server.on('exit', (code) =>
    reject(new Error(`サーバーが起動できませんでした（終了コード ${code}）`)),
  );
});

try {
  await seed();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const ym = businessDay().slice(0, 7);
  const screens = [
    ['today', '/'],
    ['morning', '/morning'],
    ['reflection', '/reflection'],
    ['backlog', '/backlog'],
    ['timeline', '/timeline'],
    ['calendar', `/calendar/${ym}`],
    ['mame', '/dev/mame'],
  ];
  for (const [name, path] of screens) {
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    console.log(`${name}: ${join('.data/screenshots', `${name}.png`)}`);
  }
  // 詳細ペインを開いた状態も撮る（Figma「PC/今日」は選択中のタスクを表示している）
  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('.task-title').first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'today-selected.png') });
  console.log(`today-selected: ${join('.data/screenshots', 'today-selected.png')}`);
  await browser.close();
} finally {
  server.kill('SIGTERM');
}

/** 業務日（Asia/Tokyo、5:00 切り替え。設定を読めるようになるまではサーバーと同じ初期値） */
function businessDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(
    new Date(Date.now() - 5 * 60 * 60 * 1000),
  );
}

/** 画面の確認に必要な最小限の見本を API で入れる（2週間分のシードデータは #26） */
async function seed() {
  const token = readFileSync(join(dataDir, 'session-token'), 'utf8').trim();
  const day = businessDay();
  const headers = {
    'Content-Type': 'application/json',
    'X-Mymind-Token': token,
    Origin: base,
    'Sec-Fetch-Site': 'same-origin',
  };
  const post = async (path, body) => {
    const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  const add = async (title, extra = {}) =>
    (await post('/api/tasks', { title, expectedDay: day, ...extra })).task;
  const to = async (task, status) =>
    (
      await post(`/api/tasks/${task.id}/transition`, {
        to: status,
        expectedVersion: task.version,
        expectedDay: day,
      })
    ).task;

  const q4 = await add('Q4プロダクト計画');
  await to(await add('企画書ドラフトを書く', { parentId: q4.id, planFor: 'today' }), 'doing');
  await to(
    await to(await add('競合調査のまとめ', { parentId: q4.id, planFor: 'today' }), 'doing'),
    'waiting',
  );
  const mvp = await add('TODOツール MVP', { planFor: 'today' });
  await to(await add('D1のスキーマ設計', { parentId: mvp.id, planFor: 'today' }), 'doing');
  await add('Honoでルーティング', { parentId: mvp.id, planFor: 'today' });
  await add('CTOとの1on1アジェンダ', { planFor: 'today' });
  await to(await to(await add('チームの週報ドラフト', { planFor: 'today' }), 'doing'), 'paused');
  await to(await to(await add('経費精算', { planFor: 'today' }), 'doing'), 'done');
  await add('Access のサービストークン発行', { parentId: mvp.id });
  await add('歯医者の予約');
  await add('確定申告の書類を集める');
}
