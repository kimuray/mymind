import type { TagColor } from '@mymind/domain';
import { TagChip } from './TagChip';

/** タグごとの集計の1行（API の tagStats。件数と日数はサーバーが domain の関数で数える、FR-A10） */
export type TagStatRow = {
  tag: { id: string; name: string; color: TagColor } | null;
  completed: number;
  doingDays: number;
  waitingDays: number;
};

const tagCell = (tag: TagStatRow['tag']) =>
  tag === null ? (
    <span className="tag-stats-none">タグなし</span>
  ) : (
    <TagChip name={tag.name} color={tag.color} />
  );

/**
 * タグごとの集計の表（FR-R08、DESIGN.md 4.24）。完了の数と、着手中・待ちの日数を並べる。
 * 集計は今付いているタグで数え、複数のタグが付いたタスクはそれぞれに数えるので、行を足しても全体の件数にはならない
 */
export function TagStatsTable({
  stats,
  caption,
}: {
  stats: readonly TagStatRow[];
  caption: string;
}) {
  if (stats.length === 0) return null;
  return (
    <table className="tag-stats">
      <caption className="text-label">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">タグ</th>
          <th scope="col">完了</th>
          <th scope="col">着手中</th>
          <th scope="col">待ち</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s) => (
          <tr key={s.tag?.id ?? 'none'}>
            <th scope="row">{tagCell(s.tag)}</th>
            <td>{s.completed}件</td>
            <td>{s.doingDays}日</td>
            <td>{s.waitingDays}日</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** タグごとの完了の数だけを、チップと数で1行に並べる（カレンダーの月の欄、FR-R08）。完了がなければ出さない */
export function TagCompletedCounts({
  stats,
  label,
}: {
  stats: readonly TagStatRow[];
  label: string;
}) {
  const completed = stats.filter((s) => s.completed > 0);
  if (completed.length === 0) return null;
  return (
    <ul className="tag-completed" aria-label={label}>
      {completed.map((s) => (
        <li key={s.tag?.id ?? 'none'}>
          {tagCell(s.tag)}
          <span className="tag-completed-count">{s.completed}件</span>
        </li>
      ))}
    </ul>
  );
}
