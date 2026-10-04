import { Link } from '@tanstack/react-router';
import { type MonthDay, useMonth } from '../api/calendar';
import { useCancelJob, useSetCondition } from '../api/feedback';
import { useRequestFeedback } from '../api/reflection';
import { useDayPlan } from '../api/tasks';
import { formatSummary } from '../components/DaySummary';
import { effectiveLevel, FeedbackPanel, moodOfLevel } from '../components/FeedbackPanel';
import { Mame, MOOD_LABELS } from '../components/Mame';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { PageLayout } from '../components/PageLayout';
import { formatDayHeading } from '../day';

const WEEKDAY_HEADERS = ['月', '火', '水', '木', '金', '土', '日'] as const;

/** 「2026年9月」 */
export function formatMonthHeading(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** n か月前後の月（YYYY-MM）。年をまたぐ */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1 + n, 1));
  return date.toISOString().slice(0, 7);
}

/** 月曜始まりの表で、1日の前に置く空きの数 */
export function leadingBlanks(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  const weekday = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1)).getUTCDay();
  return (weekday + 6) % 7;
}

/** 日付の見出し「9月5日（土）」 */
export function formatDayTitle(day: string): string {
  const { date, weekday } = formatDayHeading(day);
  return `${date}（${weekday.slice(0, 1)}）`;
}

/** 日のマスの読み上げ名。表情と件数を文字でも伝える（NFR-06） */
export function cellLabel(d: MonthDay): string {
  const title = formatDayTitle(d.day);
  if (d.isFuture) return `${title} まだ来ていない日`;
  if (d.isBlank) return `${title} 記録なし`;
  const level = effectiveLevel(d.condition);
  const mood = level === null ? 'FBなし' : `調子：${MOOD_LABELS[moodOfLevel(level)]}`;
  return `${title} ${mood}${d.completedCount > 0 ? ` 完了${d.completedCount}` : ''}`;
}

function DayCell({
  d,
  ym,
  today,
  selected,
}: {
  d: MonthDay;
  ym: string;
  today: string;
  selected: boolean;
}) {
  const level = effectiveLevel(d.condition);
  return (
    <Link
      to="/calendar/$ym/{-$day}"
      params={{ ym, day: d.day }}
      className="calendar-cell"
      data-future={d.isFuture}
      data-today={d.day === today}
      // 選んだ日は URL に入るので、ルーターがそのリンクに aria-current="page" を付ける
      data-selected={selected}
      aria-label={cellLabel(d)}
    >
      <span className="calendar-date">{Number(d.day.slice(8))}</span>
      {!d.isFuture &&
        (d.isBlank ? (
          <span className="calendar-note">記録なし</span>
        ) : (
          <>
            <Mame mood={moodOfLevel(level)} size={40} label="" />
            {d.completedCount > 0 && (
              <span className="calendar-note">{`完了 ${d.completedCount}`}</span>
            )}
          </>
        ))}
    </Link>
  );
}

const SUMMARY_ROWS = [
  { key: 'completed', label: '完了', tone: 'done' },
  { key: 'started', label: '着手', tone: 'doing' },
  { key: 'changes', label: '変化', tone: 'waiting' },
] as const;

/** 選んだ日の記録（完了・状態の変化・振り返り・FB、FR-R04）と、FB の後追い依頼（FR-A05） */
function DayRecord({ d }: { d: MonthDay }) {
  const day = useDayPlan(d.day);
  const request = useRequestFeedback(d.day);
  const cancel = useCancelJob(d.day);
  const setCondition = useSetCondition(d.day);
  const title = formatDayTitle(d.day);

  if (d.isFuture) {
    return <p className="empty-note">{`${title}はまだ来ていない日です`}</p>;
  }
  if (day.data === undefined) {
    return (
      <p className="text-small">
        {day.isError ? '記録を読み込めませんでした' : '読み込んでいます…'}
      </p>
    );
  }
  const { summary, log, feedback, condition, job } = day.data;
  const text = formatSummary(summary);
  const rows = SUMMARY_ROWS.filter((r) => summary[r.key].length > 0);
  const hasLog = log !== null && (log.thoughtsMd.trim() !== '' || log.learningMd.trim() !== '');

  return (
    <div className="calendar-record">
      <h2 className="calendar-record-title">{title}</h2>
      {/* 空白日には FB の依頼のボタンを出さない（architecture.md 4.5） */}
      {d.isBlank ? (
        <p className="text-small">記録なし（アプリを開かなかった日です）</p>
      ) : (
        <>
          {rows.length > 0 && (
            <ul className="calendar-summary" aria-label="この日の記録">
              {rows.map((r) => (
                <li key={r.key}>
                  <span className="chip" data-status={r.tone}>
                    {r.key === 'completed' ? `${r.label} ${summary.completed.length}` : r.label}
                  </span>
                  <span>{text[r.key]}</span>
                </li>
              ))}
            </ul>
          )}
          {hasLog && log !== null && (
            <>
              <section className="calendar-reflection" aria-label="思考の整理">
                <h3 className="text-label">思考の整理</h3>
                <MarkdownPreview source={log.thoughtsMd} emptyText="書いていません" />
              </section>
              <section className="calendar-reflection" aria-label="学び">
                <h3 className="text-label">学び</h3>
                <MarkdownPreview source={log.learningMd} emptyText="書いていません" />
              </section>
            </>
          )}
          <FeedbackPanel
            heading="この日のフィードバック"
            dayLabel={formatDayHeading(d.day).date}
            feedback={feedback}
            condition={condition}
            job={job}
            onRequest={() => request.mutate(undefined)}
            onCancel={(jobId) => cancel.mutate(jobId)}
            onChangeCondition={(level) => setCondition.mutate(level)}
            busy={request.isPending || cancel.isPending}
          />
        </>
      )}
    </div>
  );
}

/** カレンダー（Figma「PC/カレンダー」、/calendar/:ym/:day?、FR-R04、FR-A05、FR-A09） */
export function CalendarPage({ ym, day }: { ym: string; day: string | undefined }) {
  const month = useMonth(ym);
  const data = month.data;
  const selected = data?.days.find((d) => d.day === day);

  return (
    <PageLayout
      detail={selected === undefined ? undefined : <DayRecord key={selected.day} d={selected} />}
      emptyNote="日付を選ぶと、その日の記録が表示されます"
    >
      <div className="page calendar">
        <header className="page-header calendar-header">
          <h1 className="text-display">{formatMonthHeading(ym)}</h1>
          <nav className="calendar-months" aria-label="月の移動">
            <Link
              to="/calendar/$ym/{-$day}"
              params={{ ym: shiftMonth(ym, -1), day: undefined }}
              className="calendar-month-link"
              aria-label="前の月"
            >
              ‹
            </Link>
            <Link
              to="/calendar/$ym/{-$day}"
              params={{ ym: shiftMonth(ym, 1), day: undefined }}
              className="calendar-month-link"
              aria-label="次の月"
            >
              ›
            </Link>
          </nav>
        </header>

        {month.isError && (
          <p className="settings-note" role="alert">
            月の記録を読み込めませんでした。サーバーが動いているか確かめてください
          </p>
        )}
        {data !== undefined && (
          <section className="calendar-grid glass-2" aria-label={formatMonthHeading(ym)}>
            {WEEKDAY_HEADERS.map((w) => (
              <span key={w} className="calendar-weekday" aria-hidden="true">
                {w}
              </span>
            ))}
            {Array.from({ length: leadingBlanks(ym) }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: 月の初日の前の空きで、並びは変わらない
              <span key={`blank-${i}`} className="calendar-cell-empty" />
            ))}
            {data.days.map((d) => (
              <DayCell key={d.day} d={d} ym={ym} today={data.today} selected={d.day === day} />
            ))}
          </section>
        )}
        <p className="calendar-legend text-small">
          <span>マメの表情＝その日の調子</span>
          <span>グレーのマメ＝FBをまだもらっていない日</span>
          <span>日付を選ぶと右に詳細</span>
        </p>
      </div>
    </PageLayout>
  );
}
