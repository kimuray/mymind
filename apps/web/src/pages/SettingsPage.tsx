import type { Status } from '@mymind/domain';
import { useState } from 'react';
import { type Health, useHealth } from '../api/health';
import { type AgentChoice, useSettings, useUpdateSettings } from '../api/settings';
import { AgentSelect } from '../components/AgentSelect';
import { Button } from '../components/Button';
import { PageLayout } from '../components/PageLayout';
import { formatDateTime } from '../day';

// 日時の書式は部品からも使うので day.ts に置く（このページのテストからも読めるよう、ここから出し直す）
export { formatDateTime } from '../day';

const formatDay = (day: string) => {
  const [, m, d] = day.split('-').map(Number);
  return `${m}月${d}日`;
};

/** バイト数を読みやすい単位にする（コードで計算して表示する） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  fake: '偽のアダプタ（開発用）',
};
const agentName = (name: string) => AGENT_NAMES[name] ?? name;

const BACKUP_KINDS: Record<string, string> = {
  'pre-migration': 'マイグレーションの前のスナップショット',
  'before-restore': '復元の前に残した DB',
};

const JOB_KINDS: Record<string, string> = { daily_feedback: '日次FB', monthly_summary: '月次総括' };

type RowKey = 'agent' | 'backup' | 'database' | 'failure';

type Row = {
  key: RowKey;
  label: string;
  value: string;
  note: string;
  /** 状態のチップ。状態色を流用する（正常は done、要対応は waiting、過去の失敗は paused） */
  chip: { status: Status; text: string } | null;
};

function rowsOf(h: Health): Row[] {
  const failure = h.recentFailure;
  return [
    {
      key: 'agent',
      label: 'エージェント',
      value: agentName(h.agent.name),
      note: h.agent.message ?? h.agent.executable?.version ?? '使えます',
      chip: h.agent.usable
        ? { status: 'done', text: '使えます' }
        : { status: 'waiting', text: '使えません' },
    },
    {
      key: 'backup',
      label: '最後のバックアップ',
      value: h.backup === null ? 'まだありません' : formatDateTime(h.backup.at),
      note:
        h.backup === null
          ? '毎日のバックアップは、スケジューラができてから取ります'
          : (BACKUP_KINDS[h.backup.kind] ?? h.backup.kind),
      chip: h.backup === null ? null : { status: 'done', text: '成功' },
    },
    {
      key: 'database',
      label: 'DB のサイズ',
      value: formatBytes(h.database.sizeBytes),
      note: h.database.ok
        ? 'mymind.db と WAL の合計'
        : `DB に問い合わせられません（${h.database.message ?? ''}）`,
      chip: h.database.ok ? null : { status: 'waiting', text: '問題あり' },
    },
    {
      key: 'failure',
      label: '直近の FB 生成の失敗',
      value:
        failure === null
          ? 'ありません'
          : `${formatDay(failure.period)}の${JOB_KINDS[failure.kind] ?? failure.kind}`,
      note:
        failure === null
          ? ''
          : `${failure.error ?? ''}${failure.finishedAt === null ? '' : `（${formatDateTime(failure.finishedAt)}）`}`,
      chip: failure === null ? null : { status: 'paused', text: '失敗' },
    },
  ];
}

function Chip({ chip }: { chip: Row['chip'] }) {
  if (chip === null) return null;
  return (
    <span className="chip" data-status={chip.status}>
      {chip.text}
    </span>
  );
}

function AgentDetail({ agent }: { agent: Health['agent'] }) {
  const executable =
    agent.executable === null
      ? '使いません'
      : agent.executable.found
        ? 'あります'
        : '見つかりません';
  return (
    <div className="settings-detail">
      <div className="settings-detail-head">
        <h2 className="text-title">エージェント</h2>
        <p className="text-small">FB を書くローカルのエージェント</p>
      </div>
      <section className="settings-card glass-2" aria-label={agentName(agent.name)}>
        <div className="settings-card-title">
          <h3>{agentName(agent.name)}</h3>
          <Chip
            chip={
              agent.usable
                ? { status: 'done', text: '使えます' }
                : { status: 'waiting', text: '使えません' }
            }
          />
        </div>
        <dl className="settings-facts">
          <dt>コマンド</dt>
          <dd>{agent.name}</dd>
          <dt>実行ファイル</dt>
          <dd>{executable}</dd>
          <dt>バージョン</dt>
          <dd>{agent.executable?.version ?? '—'}</dd>
        </dl>
        {agent.message !== null && (
          <div className="settings-reason">
            <h4>使えない理由</h4>
            <p>{agent.message}</p>
          </div>
        )}
      </section>
      <p className="text-small">
        ターミナルで <code>{agent.name} --version</code>{' '}
        が動くか確かめてから、「もう一度確かめる」を押してください。確かめるのは「FB
        の依頼」で選んだ既定のエージェントです。開発用の偽のアダプタは環境変数 MYMIND_AGENT=fake
        で使います。
      </p>
    </div>
  );
}

function RowDetail({ row }: { row: Row }) {
  return (
    <div className="settings-detail">
      <div className="settings-detail-head">
        <h2 className="text-title">{row.label}</h2>
      </div>
      <section className="settings-card glass-2" aria-label={row.label}>
        <div className="settings-card-title">
          <h3>{row.value}</h3>
          <Chip chip={row.chip} />
        </div>
        {row.note !== '' && <p className="settings-note">{row.note}</p>}
      </section>
    </div>
  );
}

/** FB の依頼の設定。送信内容のプレビューを依頼の前に毎回はさむか（FR-A12）と、既定のエージェント（FR-A07） */
function FeedbackSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  // 保存を待たずに表示を変える。react-query の状態の通知は次のタスクに回るので、クリックの中で決まるよう手元の状態に持つ
  const [pending, setPending] = useState<boolean | null>(null);
  const [pendingAgent, setPendingAgent] = useState<AgentChoice | null>(null);
  const checked = pending ?? settings.data?.settings.confirmBeforeRequest ?? false;
  const defaultAgent = pendingAgent ?? settings.data?.settings.defaultAgent ?? 'claude';
  return (
    <section className="task-list settings-status glass-2" aria-label="FB の依頼">
      <div className="settings-status-head">
        <h2>FB の依頼</h2>
      </div>
      <label className="settings-toggle">
        <input
          type="checkbox"
          checked={checked}
          disabled={settings.data === undefined}
          onChange={(e) => {
            const value = e.target.checked;
            setPending(value);
            // 保存できれば保存した値、失敗すれば保存されている値の表示に戻す
            update.mutate({ confirmBeforeRequest: value }, { onSettled: () => setPending(null) });
          }}
        />
        <span className="settings-row-value">
          <span className="settings-row-main">依頼の前に毎回確認する</span>
          <span className="settings-row-note">
            「保存してFBをもらう」を押したとき、エージェントに送る内容を表示してから依頼します
          </span>
        </span>
      </label>
      <div className="settings-toggle">
        <span className="settings-row-value">
          <span className="settings-row-main">既定のエージェント</span>
          <span className="settings-row-note">
            振り返りで FB
            を依頼するときに、はじめに選ばれているエージェントです。依頼のたびに振り返りの画面で切り替えられます
          </span>
        </span>
        <AgentSelect
          id="settings-default-agent"
          label="既定のエージェント"
          showLabel={false}
          value={defaultAgent}
          disabled={settings.data === undefined}
          onChange={(value) => {
            setPendingAgent(value);
            update.mutate({ defaultAgent: value }, { onSettled: () => setPendingAgent(null) });
          }}
        />
      </div>
      {(settings.isError || update.isError) && (
        <p className="settings-note" role="alert">
          設定を{settings.isError ? '読み込め' : '保存でき'}
          ませんでした。サーバーが動いているか確かめてください
        </p>
      )}
    </section>
  );
}

/** 棚卸しの日数として保存できる入力か。空の入力は Number で 0 になるので、先に除く */
export const isReviewAfterDays = (input: string): boolean => {
  if (input.trim() === '') return false;
  const n = Number(input);
  return Number.isInteger(n) && n >= 0 && n <= 365;
};

/** 棚卸しの対象にする日数（FR-R06）。0〜365日（0 ならバックログのすべてが対象）。入力のたびに保存し、範囲の外の値は保存しない */
function ReviewSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  // 入力中の文字列。空や範囲の外の値も、打ち終わるまでは消さずに見せる
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(settings.data?.settings.reviewAfterDays ?? '');
  const isValid = isReviewAfterDays(value);
  return (
    <section className="task-list settings-status glass-2" aria-label="棚卸し">
      <div className="settings-status-head">
        <h2>棚卸し</h2>
      </div>
      <label className="settings-toggle">
        <span className="settings-row-value">
          <span className="settings-row-main">棚卸しの対象にする日数</span>
          <span className="settings-row-note">
            最後に触れてからこの日数が経ったバックログのタスクを、バックログの画面で棚卸しの対象にします（0〜365日。0
            ならすべてのタスク）
          </span>
        </span>
        <input
          type="number"
          className="settings-number"
          min={0}
          max={365}
          value={value}
          disabled={settings.data === undefined}
          aria-invalid={!isValid}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            if (isReviewAfterDays(next)) {
              update.mutate({ reviewAfterDays: Number(next) }, { onSuccess: () => setDraft(null) });
            }
          }}
        />
        <span>日</span>
      </label>
      {!isValid && (
        <p className="settings-note" role="alert">
          0〜365 の整数で入力してください
        </p>
      )}
    </section>
  );
}

/** 設定（Figma「PC/設定」）。アプリの状態（NFR-21）と、FB の依頼の設定（FR-A12）を表示する */
export function SettingsPage() {
  const health = useHealth();
  const [selected, setSelected] = useState<RowKey>('agent');
  const rows = health.data === undefined ? [] : rowsOf(health.data);
  const current = rows.find((r) => r.key === selected);

  const detail =
    health.data === undefined || current === undefined ? undefined : current.key === 'agent' ? (
      <AgentDetail agent={health.data.agent} />
    ) : (
      <RowDetail row={current} />
    );

  return (
    <PageLayout detail={detail}>
      <div className="page">
        <header className="page-header">
          <h1 className="text-display">設定</h1>
          <p className="text-small">アプリの状態、FB の依頼、棚卸し</p>
        </header>
        <section className="task-list settings-status glass-2" aria-label="状態">
          <div className="settings-status-head">
            <h2>状態</h2>
            <p className="text-small" aria-live="polite">
              {health.isFetching
                ? '確かめています…'
                : health.dataUpdatedAt === 0
                  ? ''
                  : `${formatDateTime(new Date(health.dataUpdatedAt).toISOString())} に確認`}
            </p>
            <Button onClick={() => health.refetch()} disabled={health.isFetching}>
              もう一度確かめる
            </Button>
          </div>
          {health.isError && (
            <p className="settings-note" role="alert">
              状態を読み込めませんでした。サーバーが動いているか確かめてください
            </p>
          )}
          <ul>
            {rows.map((row) => (
              <li key={row.key}>
                <button
                  type="button"
                  className="settings-row"
                  data-selected={row.key === selected}
                  aria-pressed={row.key === selected}
                  onClick={() => setSelected(row.key)}
                >
                  <span className="settings-row-label">{row.label}</span>
                  <span className="settings-row-value">
                    <span className="settings-row-main">{row.value}</span>
                    {row.note !== '' && <span className="settings-row-note">{row.note}</span>}
                  </span>
                  <Chip chip={row.chip} />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-small">
          状態は開いたときと「もう一度確かめる」を押したときに確かめます。
        </p>
        <FeedbackSettings />
        <ReviewSettings />
      </div>
    </PageLayout>
  );
}
