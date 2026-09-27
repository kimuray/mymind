import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { type ReflectionDraft, useRequestFeedback, useSaveReflection } from '../api/reflection';
import { useSettings } from '../api/settings';
import { useDayPlan } from '../api/tasks';
import { AgentInputPreview } from '../components/AgentInputPreview';
import { Button } from '../components/Button';
import { Kbd } from '../components/Kbd';
import { MarkdownField, type MarkdownMode } from '../components/MarkdownField';
import { PageLayout } from '../components/PageLayout';
import { DAY_OPTIONS, formatDayHeading } from '../day';
import { useDayGuard } from '../dayGuard';
import { useKeyBindings } from '../keyboard';

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

  return (
    <>
      {guard.dialog}
      {log.isSuccess ? (
        // 日が変わったら入力欄を作り直し、その日の保存済みの内容から始める
        <ReflectionEditor
          key={day}
          day={day}
          isToday={day === guard.day}
          saved={{
            thoughtsMd: log.data.log?.thoughtsMd ?? '',
            learningMd: log.data.log?.learningMd ?? '',
          }}
        />
      ) : (
        <PageLayout>
          <p className="empty-note" aria-live="polite">
            {log.isError ? '振り返りを読み込めませんでした' : '読み込んでいます…'}
          </p>
        </PageLayout>
      )}
    </>
  );
}

function ReflectionEditor({
  day,
  isToday,
  saved,
}: {
  day: string;
  isToday: boolean;
  saved: ReflectionDraft;
}) {
  const [draft, setDraft] = useState(saved);
  const lastSaved = useRef(saved);
  const [notice, setNotice] = useState('');
  const [previewKey, setPreviewKey] = useState<number | null>(null);
  const [modes, setModes] = useState<Record<FieldKey, MarkdownMode>>({
    thoughtsMd: 'write',
    learningMd: 'write',
  });
  const save = useSaveReflection(day);
  const request = useRequestFeedback(day);
  const settings = useSettings();
  const heading = formatDayHeading(day);
  const busy = save.isPending || request.isPending;

  /** 変更がなければ保存しない。保存できなければ false */
  const saveDraft = async (): Promise<boolean> => {
    if (sameDraft(draft, lastSaved.current)) return true;
    try {
      await save.mutateAsync(draft);
      lastSaved.current = draft;
      return true;
    } catch (e) {
      setNotice(`保存できませんでした（${errorText(e)}）`);
      return false;
    }
  };

  const saveOnly = async () => {
    if (await saveDraft()) setNotice('保存しました');
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
    if (!(await saveDraft())) return;
    request.mutate(undefined, {
      onSuccess: () => setNotice('保存して、FBを依頼しました'),
      onError: (e) => setNotice(`保存しました。FBを依頼できませんでした（${errorText(e)}）`),
    });
  };

  useKeyBindings({
    'reflection.save': () => {
      if (!busy) void saveOnly();
      return true;
    },
    'reflection.saveAndRequest': () => {
      if (!busy) void saveAndRequest();
      return true;
    },
    'reflection.togglePreview': () => {
      setModes((m) => toggleModes(m, focusedField()));
      return true;
    },
  });

  const detail =
    previewKey === null ? undefined : (
      <AgentInputPreview
        key={previewKey}
        period={day}
        onRequested={() => setNotice('FBを依頼しました')}
      />
    );

  return (
    <PageLayout detail={detail} emptyNote="まだFBをもらっていません">
      <div className="page reflection">
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

        <div className="reflection-fields">
          {FIELDS.map((f) => (
            <MarkdownField
              key={f.key}
              id={f.id}
              label={f.label}
              initialValue={saved[f.key]}
              value={draft[f.key]}
              onChange={(value) => setDraft((d) => ({ ...d, [f.key]: value }))}
              mode={modes[f.key]}
              onModeChange={(mode) => setModes((m) => ({ ...m, [f.key]: mode }))}
            />
          ))}
        </div>

        <div className="reflection-actions">
          <p className="text-small reflection-notice" aria-live="polite">
            {notice}
          </p>
          <Button kind="text" disabled={busy} onClick={() => void openPreview()}>
            送信内容を見る
          </Button>
          <Button disabled={busy} onClick={() => void saveOnly()}>
            保存のみ
            <Kbd>⌘S</Kbd>
          </Button>
          <Button kind="confirm" disabled={busy} onClick={() => void saveAndRequest()}>
            保存してFBをもらう
            <Kbd tone="dark">⌘↵</Kbd>
          </Button>
        </div>
      </div>
    </PageLayout>
  );
}
