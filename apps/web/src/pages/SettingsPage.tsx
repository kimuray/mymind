import type { Status } from '@mymind/domain';
import { useState } from 'react';
import { type Health, useHealth } from '../api/health';
import { useSettings, useUpdateSettings } from '../api/settings';
import { Button } from '../components/Button';
import { PageLayout } from '../components/PageLayout';

// 画面の日時は業務日と同じタイムゾーンで出す（FR-D01。設定を読む API ができるまでは初期値）
const TIME_ZONE = 'Asia/Tokyo';

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TIME_ZONE,
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 「9月25日 16:53」の形にする */
export function formatDateTime(iso: string): string {
  const parts = Object.fromEntries(
    dateTimeFormat.formatToParts(new Date(iso)).map((p) => [p.type, p.value]),
  );
  return `${parts['month']}月${parts['day']}日 ${parts['hour']}:${parts['minute']}`;
}

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
        が動くか確かめてから、「もう一度確かめる」を押してください。使うエージェントは環境変数
        MYMIND_AGENT で切り替えられます（claude / codex / fake）。
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

/** FB の依頼の設定（FR-A12）。送信内容のプレビューを依頼の前に毎回はさむか */
function FeedbackSettings() {
  const settings = useSettings();
  const update = useUpdateSettings();
  // 保存を待たずに表示を変える。react-query の状態の通知は次のタスクに回るので、クリックの中で決まるよう手元の状態に持つ
  const [pending, setPending] = useState<boolean | null>(null);
  const checked = pending ?? settings.data?.settings.confirmBeforeRequest ?? false;
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
      {(settings.isError || update.isError) && (
        <p className="settings-note" role="alert">
          設定を{settings.isError ? '読み込め' : '保存でき'}
          ませんでした。サーバーが動いているか確かめてください
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
          <p className="text-small">アプリの状態と FB の依頼</p>
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
      </div>
    </PageLayout>
  );
}
