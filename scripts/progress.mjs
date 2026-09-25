// 直近の作業記録を新しい順に表で出す（AGENTS.md「作業の開始と再開」）。
// 使い方: node scripts/progress.mjs [件数]   件数を省くと 10 件
import { readProgressEntries, renderProgressTable } from './progress-entries.mjs';

const root = new URL('..', import.meta.url).pathname;
const arg = process.argv[2];
if (arg !== undefined && !/^[1-9]\d*$/.test(arg)) {
  console.error('使い方: pnpm progress [件数]');
  process.exit(1);
}
const limit = Number(arg ?? 10);

const { entries, problems } = readProgressEntries(root);
for (const p of problems) console.warn(p);
const recent = entries.slice(-limit).reverse();
if (recent.length === 0) {
  console.log('作業記録はまだありません（docs/progress/）');
} else {
  console.log(renderProgressTable(recent));
  console.log(`\n${entries.length} 件のうち新しい ${recent.length} 件（docs/progress/）`);
}
