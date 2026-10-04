import { daysBetween, STATUS_LABELS, type TimelineSegment } from '@mymind/domain';
import { useState } from 'react';
import { type TimelineResponse, type TimelineTask, useTimeline } from '../api/timeline';
import { effectiveLevel, moodOfLevel } from '../components/FeedbackPanel';
import { Mame, MOOD_LABELS } from '../components/Mame';
import { PageLayout } from '../components/PageLayout';
import { currentDay, formatDayHeading } from '../day';
import { useKeyBindings } from '../keyboard';

/** 表示期間（FR-R01：1週間か2週間） */
const SPANS = [
  { days: 7, label: '1週間' },
  { days: 14, label: '2週間' },
] as const;
type Span = (typeof SPANS)[number]['days'];

const DAY_MS = 86_400_000;

/** n 日前後の業務日（暦の計算だけなのでタイムゾーンに依存しない） */
export const shiftDay = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** 「9月9日 – 9月22日」 */
export function formatRange(from: string, to: string): string {
  return `${formatDayHeading(from).date} – ${formatDayHeading(to).date}`;
}

/** 区間の始まりと終わりの列（表の2列目が期間の初日。1列目はタスクの名前） */
export function segmentColumns(from: string, segment: Pick<TimelineSegment, 'from' | 'to'>) {
  return {
    start: daysBetween(from, segment.from) + 2,
    end: daysBetween(from, segment.to) + 3,
  };
}

/** 詳細の副題。「9月9日 着手 → 継続中（14日目）」「9月11日 着手 → 9月17日 完了（7日）」 */
export function spanNote(task: Pick<TimelineTask, 'breakdown'>, today: string): string {
  const { startedDay, completedDay } = task.breakdown;
  if (startedDay === null) return 'まだ着手していません';
  const started = `${formatDayHeading(startedDay).date} 着手`;
  if (completedDay === null) {
    return `${started} → 継続中（${daysBetween(startedDay, today) + 1}日目）`;
  }
  if (completedDay === startedDay) return `${started} → 同日完了`;
  const days = daysBetween(startedDay, completedDay) + 1;
  return `${started} → ${formatDayHeading(completedDay).date} 完了（${days}日）`;
}

/** 行の読み上げ名。横棒の状態と期間を文字でも伝える（色や形だけに頼らない、NFR-06） */
export function rowLabel(task: Pick<TimelineTask, 'title' | 'segments'>): string {
  if (task.segments.length === 0) return task.title;
  const parts = task.segments.map((s) => `${STATUS_LABELS[s.status]} ${formatRange(s.from, s.to)}`);
  return `${task.title}：${parts.join('、')}`;
}

const isWeekend = (day: string) => {
  const w = new Date(`${day}T00:00:00Z`).getUTCDay();
  return w === 0 || w === 6;
};

/** 日ごとの列の背景（今日と土日）。日付の行と、調子とタスクの行で濃さを変える */
const columnKind = (day: string, today: string) =>
  day === today ? 'today' : isWeekend(day) ? 'weekend' : undefined;

function SegmentBar({
  from,
  today,
  segment,
}: {
  from: string;
  today: string;
  segment: TimelineSegment;
}) {
  const { start, end } = segmentColumns(from, segment);
  return (
    <span
      className="timeline-bar"
      data-status={segment.status}
      data-open-start={segment.continuesBefore}
      // 今日まで続く区間は、まだ来ていない日を描かないので今日で丸める（Figma「PC/タイムライン」）
      data-open-end={segment.continuesAfter && segment.to !== today}
      style={{ gridColumn: `${start} / ${end}` }}
      title={`${STATUS_LABELS[segment.status]}：${formatRange(segment.from, segment.to)}`}
    />
  );
}

function TaskRow({
  task,
  data,
  selected,
  onSelect,
}: {
  task: TimelineTask;
  data: TimelineResponse;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="timeline-row timeline-task" data-selected={selected}>
      <button
        type="button"
        className="timeline-name"
        aria-pressed={selected}
        aria-label={rowLabel(task)}
        onClick={onSelect}
      >
        {task.title}
      </button>
      {data.days.map((d, i) => (
        <span
          key={d.day}
          className="timeline-cell"
          data-column={columnKind(d.day, data.today)}
          style={{ gridColumn: i + 2 }}
        />
      ))}
      {task.segments.map((s) => (
        <SegmentBar key={`${s.status}-${s.from}`} from={data.from} today={data.today} segment={s} />
      ))}
    </div>
  );
}

const BREAKDOWN = [
  { key: 'doing', label: '着手中' },
  { key: 'paused', label: '中断' },
  { key: 'waiting', label: '待ち' },
] as const;

/** 選んだタスクの期間の内訳（FR-R03）。日数はサーバーが domain で数えた値 */
function TaskBreakdown({ task, today }: { task: TimelineTask; today: string }) {
  const total = BREAKDOWN.reduce((sum, b) => sum + task.breakdown[b.key], 0);
  return (
    <section className="timeline-detail" aria-label={`${task.title}の期間の内訳`}>
      <div>
        <h2 className="timeline-detail-title">{task.title}</h2>
        <p className="text-small">{spanNote(task, today)}</p>
      </div>
      <h3 className="text-label">期間の内訳</h3>
      <div className="timeline-stack" aria-hidden="true">
        {BREAKDOWN.filter((b) => task.breakdown[b.key] > 0).map((b) => (
          <span
            key={b.key}
            className="timeline-stack-part"
            data-status={b.key}
            style={{ flexGrow: task.breakdown[b.key] }}
          />
        ))}
        {total === 0 && <span className="timeline-stack-part" />}
      </div>
      <dl className="timeline-counts">
        {BREAKDOWN.map((b) => (
          <div key={b.key}>
            <dt>{b.label}</dt>
            <dd>
              <span className="timeline-count">{task.breakdown[b.key]}</span>日
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const LEGEND = [
  { status: 'doing', label: '着手中' },
  { status: 'paused', label: '中断' },
  { status: 'waiting', label: '待ち' },
  { status: 'done', label: '完了したタスクの期間' },
] as const;

/** タイムライン（Figma「PC/タイムライン」、/timeline、FR-R01〜R03） */
export function TimelinePage() {
  const today = currentDay();
  const [span, setSpan] = useState<Span>(14);
  // 表示期間の末日。初めは今日。前後の期間へは表示している日数ずつ動かす
  const [to, setTo] = useState(today);
  const from = shiftDay(to, -(span - 1));
  const timeline = useTimeline(from, to);
  const data = timeline.data;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tasks = data?.tasks ?? [];
  const selected = tasks.find((t) => t.id === selectedId);

  const moveSelection = (step: 1 | -1) => {
    if (tasks.length === 0) return false;
    const i = tasks.findIndex((t) => t.id === selectedId);
    const next = tasks[i === -1 ? 0 : Math.min(Math.max(i + step, 0), tasks.length - 1)];
    if (next !== undefined) setSelectedId(next.id);
    return true;
  };
  useKeyBindings({
    'list.next': () => moveSelection(1),
    'list.prev': () => moveSelection(-1),
    escape: () => {
      if (selectedId === null) return false;
      setSelectedId(null);
      return true;
    },
  });

  return (
    <PageLayout
      detail={
        selected === undefined || data === undefined ? undefined : (
          <TaskBreakdown task={selected} today={data.today} />
        )
      }
      emptyNote="タスクの行を選ぶと、期間の内訳が表示されます"
    >
      <div className="page timeline">
        <header className="page-header timeline-header">
          <h1 className="text-display">タイムライン</h1>
          <div className="timeline-controls">
            <button
              type="button"
              className="calendar-month-link"
              aria-label="前の期間"
              onClick={() => setTo(shiftDay(to, -span))}
            >
              ‹
            </button>
            {/* 期間を切り替えた直後は前の期間の表を出しているので、見出しも表と同じ期間にする */}
            <span className="timeline-range">
              {formatRange(data?.from ?? from, data?.to ?? to)}
            </span>
            <button
              type="button"
              className="calendar-month-link"
              aria-label="次の期間"
              disabled={to >= today}
              onClick={() => {
                const next = shiftDay(to, span);
                setTo(next > today ? today : next);
              }}
            >
              ›
            </button>
            <fieldset className="segmented" aria-label="表示期間">
              {SPANS.map((s) => (
                <button
                  key={s.days}
                  type="button"
                  className="segmented-item"
                  aria-pressed={span === s.days}
                  onClick={() => setSpan(s.days)}
                >
                  {s.label}
                </button>
              ))}
            </fieldset>
          </div>
        </header>

        {timeline.isError && (
          <p className="settings-note" role="alert">
            タイムラインを読み込めませんでした。サーバーが動いているか確かめてください
          </p>
        )}
        {data !== undefined && (
          <section
            className="timeline-table glass-2"
            aria-label={`${formatRange(data.from, data.to)}のタイムライン`}
            aria-busy={timeline.isPlaceholderData}
            data-updating={timeline.isPlaceholderData}
            style={{ ['--timeline-days' as string]: data.days.length }}
          >
            <div className="timeline-row timeline-head">
              <span />
              {data.days.map((d, i) => {
                const { weekday } = formatDayHeading(d.day);
                return (
                  <span
                    key={d.day}
                    className="timeline-date"
                    data-column={columnKind(d.day, data.today)}
                    style={{ gridColumn: i + 2 }}
                  >
                    <span>{Number(d.day.slice(8))}</span>
                    <span className="timeline-weekday">
                      {d.day === data.today ? '今日' : weekday.slice(0, 1)}
                    </span>
                  </span>
                );
              })}
            </div>
            <div className="timeline-row timeline-lane">
              <span className="timeline-lane-label">調子</span>
              {data.days.map((d, i) => {
                const level = effectiveLevel(d.condition);
                const mood = moodOfLevel(level);
                return (
                  <span
                    key={d.day}
                    className="timeline-cell"
                    data-column={columnKind(d.day, data.today)}
                    style={{ gridColumn: i + 2 }}
                  >
                    {!d.isFuture && (
                      <Mame
                        mood={mood}
                        size={26}
                        label={`${formatDayHeading(d.day).date}：${level === null ? 'FBなし' : MOOD_LABELS[mood]}`}
                      />
                    )}
                  </span>
                );
              })}
            </div>
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                data={data}
                selected={task.id === selectedId}
                onSelect={() => setSelectedId(task.id)}
              />
            ))}
            {tasks.length === 0 && (
              <p className="empty-note">この期間に着手したタスクはありません</p>
            )}
          </section>
        )}
        <ul className="timeline-legend" aria-label="凡例">
          {LEGEND.map((l) => (
            <li key={l.status}>
              <span className="timeline-legend-bar" data-status={l.status} />
              {l.label}
            </li>
          ))}
        </ul>
      </div>
    </PageLayout>
  );
}
