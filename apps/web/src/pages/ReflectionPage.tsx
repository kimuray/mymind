import type { DaySummary as DaySummaryData } from '@mymind/domain';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { useCancelJob, useSetCondition } from '../api/feedback';
import { type ReflectionDraft, useRequestFeedback, useSaveReflection } from '../api/reflection';
import { type AgentChoice, useSettings } from '../api/settings';
import { type DayResponse, useDayPlan } from '../api/tasks';
import { AgentInputPreview } from '../components/AgentInputPreview';
import { AgentSelect } from '../components/AgentSelect';
import { Button } from '../components/Button';
import { DaySummary } from '../components/DaySummary';
import { FeedbackPanel } from '../components/FeedbackPanel';
import { Kbd } from '../components/Kbd';
import { Loading } from '../components/Loading';
import { MarkdownField, type MarkdownMode } from '../components/MarkdownField';
import { PageLayout } from '../components/PageLayout';
import { DAY_OPTIONS, formatDateTime, formatDayHeading } from '../day';
import { useDayGuard } from '../dayGuard';
import { useKeyBindings } from '../keyboard';
import { useListMotion } from '../listMotion';
import { useFadeInAfterLoading } from '../loadMotion';
import { useReflectionDrafts } from '../useReflectionDrafts';

const sameDraft = (a: ReflectionDraft, b: ReflectionDraft) =>
  a.thoughtsMd === b.thoughtsMd && a.learningMd === b.learningMd;

type FieldKey = keyof ReflectionDraft;
const FIELDS: readonly { key: FieldKey; id: string; label: string }[] = [
  { key: 'thoughtsMd', id: 'reflection-thoughts', label: '思考の整理' },
  { key: 'learningMd', id: 'reflection-learning', label: '学び' },
];

/**
 * ⌘P の切り替え。フォーカスのある欄だけを切り替え、欄の外なら両方を切り替える
 * （どちらかが「書く」なら両方をプレビューに、両方がプレビューなら両方を「書く」に）
 */
export function toggleModes(
  modes: Record<FieldKey, MarkdownMode>,
  focused: FieldKey | null,
): Record<FieldKey, MarkdownMode> {
  const flip = (m: MarkdownMode): MarkdownMode => (m === 'write' ? 'preview' : 'write');
  if (focused !== null) return { ...modes, [focused]: flip(modes[focused]) };
  const next: MarkdownMode = Object.values(modes).includes('write') ? 'preview' : 'write';
  return { thoughtsMd: next, learningMd: next };
}

/** フォーカスのある欄 */
const focusedField = (): FieldKey | null => {
  const id = document.activeElement
    ?.closest('[data-markdown-field]')
    ?.getAttribute('data-markdown-field');
  return FIELDS.find((f) => f.id === id)?.key ?? null;
};

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : '通信に失敗しました');

/** 夕方の地色（DESIGN.md 2.1 の --ground-evening）は、振り返りの画面を開いているあいだだけ使う */
function useEveningGround() {
  useEffect(() => {
    document.body.dataset['ground'] = 'evening';
    return () => {
      delete document.body.dataset['ground'];
    };
  }, []);
}

/**
 * 振り返りの画面（Figma「PC/振り返り」、FR-D06・FR-D08）。
 * :day を省けば今の業務日を開き、業務日が変わったら今日へ移るか前の日として続けるかを選ばせる（NFR-14）。
 * :day を指定すれば、過去の日の振り返りを書き足せる
 */
export function ReflectionPage({ day: dayParam }: { day: string | undefined }) {
  useEveningGround();
  const guard = useDayGuard(dayParam === undefined);
  const day = dayParam ?? guard.day;
  const log = useDayPlan(day);
  // 読み込み中を経て入力欄を出すときは、フェードインさせる（DESIGN.md 4.19）。入力欄は読み込みの後に作られるので、ここで見て渡す
  const sawLoading = useRef(false);
  if (!log.isSuccess) sawLoading.current = true;
  useEffect(() => {
    if (log.isSuccess) sawLoading.current = false;
  }, [log.isSuccess]);

  return (
    <>
      {guard.dialog}
      {log.isSuccess ? (
        // 日が変わったら入力欄を作り直し、その日の保存済みの内容から始める
        <ReflectionEditor
          key={day}
          day={day}
          fadeIn={sawLoading.current}
          isToday={day === guard.day}
          summary={log.data.summary}
          dayData={log.data}
          saved={{
            thoughtsMd: log.data.log?.thoughtsMd ?? '',
            learningMd: log.data.log?.learningMd ?? '',
            updatedAt: log.data.log?.updatedAt ?? null,
          }}
        />
      ) : (
        <PageLayout>
          {log.isError ? (
            <p className="empty-note" role="alert">
              振り返りを読み込めませんでした
            </p>
          ) : (
            <Loading />
          )}
        </PageLayout>
      )}
    </>
  );
}

function ReflectionEditor({
  day,
  fadeIn,
  isToday,
  saved,
  summary,
  dayData,
}: {
  day: string;
  /** 読み込み中を経て作られたか。true なら、出るときにフェードインさせる */
  fadeIn: boolean;
  isToday: boolean;
  saved: ReflectionDraft & { updatedAt: string | null };
  summary: DaySummaryData;
  /** その日の FB・調子・最新のジョブ（GET /api/days/:day） */
  dayData: Pick<DayResponse, 'feedback' | 'condition' | 'job'>;
}) {
  const savedText = { thoughtsMd: saved.thoughtsMd, learningMd: saved.learningMd };
  const [draft, setDraft] = useState<ReflectionDraft>(savedText);
  // 入力欄の最初の内容。下書きを復元したら、復元した内容で入力欄を作り直す
  const [initial, setInitial] = useState<ReflectionDraft>(savedText);
  const [editorVersion, setEditorVersion] = useState(0);
  const lastSaved = useRef<ReflectionDraft>(savedText);
  const drafts = useReflectionDrafts({ day, draft, saved });
  // 下書きの案内が出入りしても、入力欄が急に押し下げられないようにする（DESIGN.md 4.18、FR-T06）
  const pageRoot = useRef<HTMLDivElement>(null);
  useListMotion(pageRoot, true);
  useFadeInAfterLoading(pageRoot, false, fadeIn);
  const [notice, setNotice] = useState('');
  const [previewKey, setPreviewKey] = useState<number | null>(null);
  const [modes, setModes] = useState<Record<FieldKey, MarkdownMode>>({
    thoughtsMd: 'write',
    learningMd: 'write',
  });
  const save = useSaveReflection(day);
  const request = useRequestFeedback(day);
  const settings = useSettings();
  const cancel = useCancelJob(day);
  const setCondition = useSetCondition(day);
  // 画面で選び直すまでは、設定の既定のエージェントを使う（FR-A07）
  const [chosenAgent, setChosenAgent] = useState<AgentChoice | null>(null);
  const defaultAgent = settings.data?.settings.defaultAgent;
  // 設定を読み込む前は送らずに、サーバーに既定のエージェントを選ばせる
  const agent = chosenAgent ?? defaultAgent;
  const heading = formatDayHeading(day);
  const busy = save.isPending || request.isPending;
  // どのボタンで始めた処理か。押したボタンだけを処理中として示す（DESIGN.md 4.19）
  const [running, setRunning] = useState<'save' | 'request' | null>(null);

  /** 変更がなければ保存しない。保存できなければ false */
  const saveDraft = async (): Promise<boolean> => {
    if (sameDraft(draft, lastSaved.current)) return true;
    try {
      await save.mutateAsync(draft);
      lastSaved.current = draft;
      drafts.clearSaved(draft);
      return true;
    } catch (e) {
      setNotice(`保存できませんでした（${errorText(e)}）`);
      return false;
    }
  };

  const saveOnly = async () => {
    setRunning('save');
    try {
      if (await saveDraft()) setNotice('保存しました');
    } finally {
      setRunning(null);
    }
  };

  /** 送信内容のプレビューを開く（開き直すたびに作り直す） */
  const openPreview = async () => {
    if (!(await saveDraft())) return;
    setNotice('');
    setPreviewKey((k) => (k ?? 0) + 1);
  };

  const saveAndRequest = async () => {
    // 「依頼の前に毎回確認する」が有効なら、依頼の前に必ず送信内容を見せる（FR-A12）
    if (settings.data?.settings.confirmBeforeRequest ?? false) {
      await openPreview();
      return;
    }
    setRunning('request');
    if (!(await saveDraft())) {
      setRunning(null);
      return;
    }
    request.mutate(agent, {
      onSuccess: () => setNotice('保存して、FBを依頼しました'),
      onError: (e) => setNotice(`保存しました。FBを依頼できませんでした（${errorText(e)}）`),
      onSettled: () => setRunning(null),
    });
  };

  const restoreDrafts = () => {
    if (drafts.offer === null) return;
    const restored = { ...draft };
    for (const f of FIELDS) restored[f.key] = drafts.offer.drafts[f.key]?.text ?? restored[f.key];
    setInitial(restored);
    setDraft(restored);
    setEditorVersion((v) => v + 1);
    drafts.dismiss();
    setNotice('下書きを復元しました。まだ保存していません');
  };

  useKeyBindings({
    'reflection.save': () => {
      if (!busy) void saveOnly();
      return true;
    },
    'screen.submit': () => {
      if (!busy) void saveAndRequest();
      return true;
    },
    'reflection.togglePreview': () => {
      setModes((m) => toggleModes(m, focusedField()));
      return true;
    },
  });

  const detail =
    previewKey === null ? (
      <FeedbackPanel
        heading={isToday ? '今日のフィードバック' : 'この日のフィードバック'}
        {...(isToday ? {} : { dayLabel: heading.date })}
        feedback={dayData.feedback}
        condition={dayData.condition}
        job={dayData.job}
        onRequest={() => void saveAndRequest()}
        onCancel={(jobId) => cancel.mutate(jobId)}
        onChangeCondition={(level) => setCondition.mutate(level)}
        busy={busy || cancel.isPending}
      />
    ) : (
      <AgentInputPreview
        key={previewKey}
        period={day}
        agent={agent}
        onRequested={() => {
          setNotice('FBを依頼しました');
          // 依頼したら送信内容を閉じ、生成の進み具合を見せる
          setPreviewKey(null);
        }}
      />
    );

  return (
    <PageLayout detail={detail} emptyNote="まだFBをもらっていません">
      <div className="page reflection" ref={pageRoot}>
        <header className="page-header">
          <div className="reflection-title">
            <p className="text-label">振り返り</p>
            <h1 className="text-display">
              {heading.date}
              <span className="page-weekday">{heading.weekday}</span>
            </h1>
          </div>
          {isToday && (
            <p className="text-small">{`翌 ${DAY_OPTIONS.dayStartHour}:00 までこの日の記録になります`}</p>
          )}
        </header>

        <DaySummary summary={summary} />

        {drafts.offer !== null && (
          <div className="draft-offer glass-2" role="status" data-motion-key="ui:draft-offer">
            <p>{`保存していない下書きがあります（${formatDateTime(drafts.offer.updatedAt)}）`}</p>
            <Button kind="text" onClick={restoreDrafts}>
              復元する
            </Button>
            <Button kind="text" onClick={() => void drafts.discard()}>
              破棄する
            </Button>
          </div>
        )}

        <div className="reflection-fields" data-motion-key="ui:fields">
          {FIELDS.map((f) => (
            <MarkdownField
              key={`${f.key}-${editorVersion}`}
              id={f.id}
              label={f.label}
              initialValue={initial[f.key]}
              value={draft[f.key]}
              onChange={(value) => setDraft((d) => ({ ...d, [f.key]: value }))}
              mode={modes[f.key]}
              onModeChange={(mode) => setModes((m) => ({ ...m, [f.key]: mode }))}
            />
          ))}
        </div>

        <div className="reflection-actions" data-motion-key="ui:actions">
          <AgentSelect
            id="reflection-agent"
            label="エージェント"
            // 下端のボタンと1行に収めるため、見出しは出さない（選択肢がエージェントの名前そのもの）
            showLabel={false}
            fakeAgent={settings.data?.runtime.fakeAgent === true ? 'chip' : undefined}
            value={agent ?? 'claude'}
            onChange={setChosenAgent}
            disabled={busy || agent === undefined}
          />
          <p className="text-small reflection-notice" aria-live="polite">
            {notice}
          </p>
          <Button kind="text" disabled={busy} onClick={() => void openPreview()}>
            送信内容を見る
          </Button>
          <Button disabled={busy} busy={running === 'save'} onClick={() => void saveOnly()}>
            保存のみ
            <Kbd>⌘S</Kbd>
          </Button>
          <Button
            kind="confirm"
            disabled={busy}
            busy={running === 'request'}
            onClick={() => void saveAndRequest()}
          >
            保存してFBをもらう
            <Kbd tone="dark">⌘↵</Kbd>
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
