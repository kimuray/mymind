import { useRef, useState } from 'react';
import type { DayResponse } from '../api/tasks';
import { formatDateTime } from '../day';
import { Button } from './Button';
import { Mame, MOOD_LABELS, type Mood } from './Mame';

type Feedback = NonNullable<DayResponse['feedback']>;
type Condition = NonNullable<DayResponse['condition']>;
type Job = NonNullable<DayResponse['job']>;

/** 調子の5段階（0:絶不調 〜 4:絶好調、FR-A02）とマメの表情 */
const LEVEL_MOODS: readonly Mood[] = ['worst', 'bad', 'normal', 'good', 'best'];

/** 調子の段階のマメの表情。調子がなければ「おやすみ中」（FR-A09） */
export const moodOfLevel = (level: number | null): Mood =>
  level === null ? 'sleep' : (LEVEL_MOODS[level] ?? 'sleep');

/** 表示する調子。手動で直した値があればそれ、なければ AI の判定（FR-A03） */
export function effectiveLevel(
  condition: Pick<Condition, 'aiLevel' | 'userLevel'> | null,
): number | null {
  return condition?.userLevel ?? condition?.aiLevel ?? null;
}

/** FB の生成の状態（DESIGN.md 4.6）。最新のジョブが待機中・実行中なら生成中、失敗なら失敗 */
export function feedbackState(
  feedback: Feedback | null,
  job: Job | null,
): 'none' | 'generating' | 'failed' | 'done' {
  if (job?.status === 'queued' || job?.status === 'running') return 'generating';
  if (job?.status === 'failed') return 'failed';
  return feedback?.content == null ? 'none' : 'done';
}

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  fake: '偽のエージェント',
};

/** 生成中の3段階の進捗（依頼した、考えている、まとめている） */
const STEPS = ['依頼しました', 'マメが考えています', '仕上げています'] as const;

function ConditionPicker({
  condition,
  onChange,
}: {
  condition: Condition | null;
  onChange: (level: number | null) => void;
}) {
  const level = effectiveLevel(condition);
  // 押した選択肢のマメを小さく弾ませる（DESIGN.md 4.6）。押すたびに作り直して、同じ選択肢でも弾む
  const [picked, setPicked] = useState<{ level: number; count: number } | null>(null);
  return (
    <fieldset className="condition-picker" aria-label="調子を直す">
      {LEVEL_MOODS.map((mood, i) => (
        <button
          key={mood}
          type="button"
          className="condition-option"
          aria-pressed={level === i}
          // 手動で選んだ値をもう一度押すと、AI の判定に戻す
          onClick={() => {
            setPicked((p) => ({ level: i, count: (p?.count ?? 0) + 1 }));
            onChange(condition?.userLevel === i ? null : i);
          }}
        >
          <span
            key={picked?.level === i ? picked.count : 0}
            className="condition-mame"
            data-picked={picked?.level === i}
          >
            <Mame mood={mood} size={28} label="" />
          </span>
          <span>{MOOD_LABELS[mood]}</span>
        </button>
      ))}
    </fieldset>
  );
}

/**
 * その日の FB（DESIGN.md 4.6、FR-A01・A02・A03・A04・A08・A09）。振り返りと朝の計画の詳細ペインで使う。
 * 状態は「未依頼・生成中・失敗・完了」の4つ。生成の進み具合はサーバーの知らせ（SSE）で読み直す
 */
export function FeedbackPanel({
  heading,
  dayLabel,
  feedback,
  condition,
  job,
  nextActionTitle = '明日の一手',
  onRequest,
  onCancel,
  onChangeCondition,
  busy = false,
}: {
  heading: string;
  /** 調子の見出しに添える日付（「9月21日（月）の」）。今日なら省く */
  dayLabel?: string;
  feedback: Feedback | null;
  condition: Condition | null;
  job: Job | null;
  /** 朝の計画では「今日の一手」と呼ぶ */
  nextActionTitle?: string;
  /** 依頼・再試行・もう一度もらう。省くと依頼のボタンを出さない */
  onRequest?: () => void;
  onCancel?: (jobId: string) => void;
  onChangeCondition: (level: number | null) => void;
  busy?: boolean;
}) {
  const state = feedbackState(feedback, job);
  const level = effectiveLevel(condition);
  const mood: Mood = state === 'generating' ? 'think' : moodOfLevel(level);
  const content = feedback?.content ?? null;
  // 生成中から FB が届いたときだけ、本文を上から順に出す（DESIGN.md 4.6）。開いたときにすでにある FB は動かさない
  const shownState = useRef(state);
  const arrived = useRef(false);
  if (shownState.current !== state) {
    arrived.current = shownState.current === 'generating' && state === 'done';
    shownState.current = state;
  }

  return (
    <section className="feedback" aria-label={heading}>
      <h2 className="text-label">{heading}</h2>
      <div className="feedback-condition">
        <div className="feedback-mame">
          <Mame mood={mood} size={68} />
        </div>
        <div className="feedback-condition-text">
          <p className="text-small">{`${dayLabel ?? '今日'}の調子`}</p>
          <p className="feedback-level" data-mood={mood}>
            {level === null ? '—' : MOOD_LABELS[mood]}
          </p>
          {condition?.userLevel != null &&
            condition.aiLevel !== null &&
            condition.userLevel !== condition.aiLevel && (
              <p className="text-small">{`手動で修正（AIの判定：${MOOD_LABELS[LEVEL_MOODS[condition.aiLevel] ?? 'sleep']}）`}</p>
            )}
        </div>
      </div>
      <ConditionPicker condition={condition} onChange={onChangeCondition} />
      {condition?.aiReason != null && (
        <p className="text-small">{`AI判定の根拠：${condition.aiReason}`}</p>
      )}

      <div aria-live="polite" className="feedback-body" data-arrived={arrived.current}>
        {state === 'generating' && job !== null && (
          <div className="feedback-generating">
            <ol className="feedback-steps">
              {STEPS.map((step, i) => (
                <li key={step} data-active={i === (job.status === 'queued' ? 0 : 1)}>
                  {step}
                </li>
              ))}
            </ol>
            {job.status === 'queued' && (
              // FB は1件ずつ作るので、ほかの日の依頼が終わるまで待つ（#23、architecture.md 7.1）
              <p className="text-small">前の依頼が終わるのを待っています。順番が来ると始まります</p>
            )}
            {onCancel !== undefined && (
              <Button onClick={() => onCancel(job.id)} disabled={busy}>
                キャンセル
              </Button>
            )}
          </div>
        )}

        {state === 'failed' && job !== null && (
          <div className="feedback-failed">
            <p>{`FBをもらえませんでした：${job.error ?? '理由が分かりません'}`}</p>
            {onRequest !== undefined && (
              <Button kind="text" onClick={onRequest} disabled={busy}>
                再試行
              </Button>
            )}
          </div>
        )}

        {state === 'none' && (
          <div className="feedback-none">
            <p>まだFBをもらっていません</p>
            {onRequest !== undefined && (
              <Button onClick={onRequest} disabled={busy}>
                FBをもらう
              </Button>
            )}
          </div>
        )}

        {content !== null && state !== 'generating' && (
          <>
            <section className="feedback-section" data-kind="good">
              <h3>よかったこと</h3>
              {content.good.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </section>
            {content.insight.length > 0 && (
              <section className="feedback-section" data-kind="insight">
                <h3>気づき</h3>
                {content.insight.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </section>
            )}
            <section className="feedback-section feedback-next" data-kind="next">
              <h3>{nextActionTitle}</h3>
              <p>{content.next_action}</p>
            </section>
            <div className="feedback-meta">
              <p className="text-small">
                {feedback === null
                  ? ''
                  : `${formatDateTime(feedback.createdAt)} に ${AGENT_NAMES[feedback.agent] ?? feedback.agent} で生成`}
              </p>
              {onRequest !== undefined && state === 'done' && (
                <Button kind="text" onClick={onRequest} disabled={busy}>
                  もう一度もらう
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
