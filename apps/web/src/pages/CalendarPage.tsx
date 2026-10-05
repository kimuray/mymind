import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type MonthDay,
  type MonthResponse,
  useCancelMonthlySummary,
  useMonth,
  useRequestMonthlySummary,
} from '../api/calendar';
import { useCancelJob, useSetCondition } from '../api/feedback';
import { useRequestFeedback } from '../api/reflection';
import { type AgentChoice, useSettings } from '../api/settings';
import { useDayPlan } from '../api/tasks';
import { AgentInputPreview } from '../components/AgentInputPreview';
import { AgentSelect } from '../components/AgentSelect';
import { formatSummary } from '../components/DaySummary';
import { effectiveLevel, FeedbackPanel, moodOfLevel } from '../components/FeedbackPanel';
import { Loading } from '../components/Loading';
import { Mame, MOOD_LABELS } from '../components/Mame';
import { MarkdownPreview } from '../components/MarkdownPreview';
import { MonthlyInputPreview } from '../components/MonthlyInputPreview';
import { MonthlySummaryPanel, summaryTitle } from '../components/MonthlySummaryPanel';
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
  const settings = useSettings();
  // 選び直すまでは設定の既定のエージェント（FR-A07）。読み込む前は送らず、サーバーに既定を選ばせる
  const [chosenAgent, setChosenAgent] = useState<AgentChoice | null>(null);
  const agent = chosenAgent ?? settings.data?.settings.defaultAgent;
  // 送信内容のプレビュー（FR-A12）。開き直すたびに作り直す
  const [previewKey, setPreviewKey] = useState<number | null>(null);
  const title = formatDayTitle(d.day);

  /** 「依頼の前に毎回確認する」が有効なら、依頼の前に必ず送信内容を見せる（FR-A12） */
  const requestFeedback = () => {
    if (settings.data?.settings.confirmBeforeRequest ?? false) {
      setPreviewKey((k) => (k ?? 0) + 1);
      return;
    }
    request.mutate(agent);
  };

  if (d.isFuture) {
    return <p className="empty-note">{`${title}はまだ来ていない日です`}</p>;
  }
  if (day.data === undefined) {
    return day.isError ? (
      <p className="text-small" role="alert">
        記録を読み込めませんでした
      </p>
    ) : (
      <Loading />
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
          {previewKey === null ? (
            <FeedbackPanel
              heading="この日のフィードバック"
              dayLabel={formatDayHeading(d.day).date}
              feedback={feedback}
              condition={condition}
              job={job}
              onRequest={requestFeedback}
              onCancel={(jobId) => cancel.mutate(jobId)}
              onChangeCondition={(level) => setCondition.mutate(level)}
              busy={request.isPending || cancel.isPending}
            />
          ) : (
            <AgentInputPreview
              key={previewKey}
              period={d.day}
              agent={agent}
              // 依頼したら送信内容を閉じ、生成の進み具合を見せる
              onRequested={() => setPreviewKey(null)}
            />
          )}
          <AgentSelect
            id="calendar-agent"
            label="エージェント"
            fakeAgent={settings.data?.runtime.fakeAgent === true ? 'chip' : undefined}
            value={agent ?? 'claude'}
            onChange={setChosenAgent}
            disabled={request.isPending || agent === undefined}
          />
        </>
      )}
    </div>
  );
}

/** その月の総括（FR-A06、FR-R05）。依頼の前の確認（FR-A12）とエージェントの選択（FR-A07）も、日次 FB と同じに扱う */
function MonthSummarySection({ ym, data }: { ym: string; data: MonthResponse }) {
  const request = useRequestMonthlySummary(ym);
  const cancel = useCancelMonthlySummary(ym);
  const settings = useSettings();
  const [chosenAgent, setChosenAgent] = useState<AgentChoice | null>(null);
  const agent = chosenAgent ?? settings.data?.settings.defaultAgent;
  const [previewKey, setPreviewKey] = useState<number | null>(null);
  // まだ始まっていない月の総括は作れない
  const isFuture = ym > data.today.slice(0, 7);

  const requestSummary = () => {
    if (settings.data?.settings.confirmBeforeRequest ?? false) {
      setPreviewKey((k) => (k ?? 0) + 1);
      return;
    }
    request.mutate(agent);
  };

  return (
    <div className="calendar-record">
      {previewKey === null ? (
        <MonthlySummaryPanel
          ym={ym}
          summary={data.summary}
          job={data.summaryJob}
          {...(isFuture ? {} : { onRequest: requestSummary })}
          onCancel={(jobId) => cancel.mutate(jobId)}
          busy={request.isPending || cancel.isPending}
        />
      ) : (
        <MonthlyInputPreview
          key={previewKey}
          ym={ym}
          agent={agent}
          // 依頼したら送信内容を閉じ、生成の進み具合を見せる
          onRequested={() => setPreviewKey(null)}
        />
      )}
      {isFuture ? (
        <p className="text-small">まだ始まっていない月です</p>
      ) : (
        <AgentSelect
          id="calendar-summary-agent"
          label="エージェント"
          fakeAgent={settings.data?.runtime.fakeAgent === true ? 'chip' : undefined}
          value={agent ?? 'claude'}
          onChange={setChosenAgent}
          disabled={request.isPending || agent === undefined}
        />
      )}
    </div>
  );
}

/** 詳細ペイン。「この日」と「◯月の総括」を切り替える（Figma「PC/カレンダー」の詳細ペイン） */
function CalendarDetail({
  ym,
  data,
  selected,
}: {
  ym: string;
  data: MonthResponse;
  selected: MonthDay | undefined;
}) {
  // 日付を選んでいれば「この日」、選んでいなければ総括から見せる（日付を選び直すと作り直す）
  const [tab, setTab] = useState<'day' | 'summary'>(selected === undefined ? 'summary' : 'day');
  return (
    <div className="calendar-detail">
      <fieldset className="segmented calendar-tabs" aria-label="詳細の表示">
        <button
          type="button"
          className="segmented-item"
          aria-pressed={tab === 'day'}
          onClick={() => setTab('day')}
        >
          この日
        </button>
        <button
          type="button"
          className="segmented-item"
          aria-pressed={tab === 'summary'}
          onClick={() => setTab('summary')}
        >
          {summaryTitle(ym)}
        </button>
      </fieldset>
      {tab === 'summary' ? (
        <MonthSummarySection ym={ym} data={data} />
      ) : selected === undefined ? (
        <p className="empty-note">日付を選ぶと、その日の記録が表示されます</p>
      ) : (
        <DayRecord d={selected} />
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
      detail={
        data === undefined ? undefined : (
          <CalendarDetail key={`${ym}-${day ?? ''}`} ym={ym} data={data} selected={selected} />
        )
      }
      detailKey={`${ym}-${day ?? ''}`}
      detailLoading={data === undefined}
      emptyNote="月の記録を読み込んでいます"
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
        {month.isPending && <Loading />}
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
