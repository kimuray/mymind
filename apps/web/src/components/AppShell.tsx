import { toBusinessDay } from '@mymind/domain';
import { Link, Outlet, useNavigate, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { reportBrowserPermission } from '../api/notifications';
import { availableActions, runAction, useKeyBindings } from '../keyboard';
import {
  commandsFor,
  type KeyAction,
  type KeyCommand,
  NAVIGATION_KEYS,
  type NavigationTarget,
  SIDEBAR_HINTS,
} from '../keymap';
import { useRealtimeSync } from '../realtime';
import { CommandPalette } from './CommandPalette';
import { Kbd } from './Kbd';
import { Mame } from './Mame';
import { NotificationBanner } from './NotificationBanner';
import { ShortcutHelp } from './ShortcutHelp';

// 業務日の切り替え（FR-D01）。設定を読む API ができるまでは初期値を使う
const DAY_OPTIONS = { timeZone: 'Asia/Tokyo', dayStartHour: 5 };

type NavItem = { target: NavigationTarget; label: string };

function NavLink({ target, label }: { target: NavigationTarget; label: string }) {
  const hint = NAVIGATION_KEYS[target].join(' ');
  const props = {
    className: 'nav-item',
    activeProps: { className: 'nav-item is-active', 'aria-current': 'page' as const },
    activeOptions: { exact: target === 'today', includeSearch: false },
  };
  const body = (
    <>
      <span className="nav-dot" aria-hidden="true" />
      <span className="nav-label">{label}</span>
      <span className="nav-hint">{hint}</span>
    </>
  );
  switch (target) {
    case 'today':
      return (
        <Link to="/" {...props}>
          {body}
        </Link>
      );
    case 'morning':
      return (
        <Link to="/morning" {...props}>
          {body}
        </Link>
      );
    case 'reflection':
      return (
        <Link to="/reflection/{-$day}" params={{ day: undefined }} {...props}>
          {body}
        </Link>
      );
    case 'backlog':
      return (
        <Link to="/backlog" {...props}>
          {body}
        </Link>
      );
    case 'timeline':
      return (
        <Link to="/timeline" {...props}>
          {body}
        </Link>
      );
    case 'calendar': {
      const ym = toBusinessDay(new Date(), DAY_OPTIONS).slice(0, 7);
      return (
        <Link to="/calendar/$ym/{-$day}" params={{ ym, day: undefined }} {...props}>
          {body}
        </Link>
      );
    }
  }
}

const DAILY: NavItem[] = [
  { target: 'today', label: '今日' },
  { target: 'morning', label: '朝の計画' },
  { target: 'reflection', label: '振り返り' },
];
const LISTS: NavItem[] = [
  { target: 'backlog', label: 'バックログ' },
  { target: 'timeline', label: 'タイムライン' },
  { target: 'calendar', label: 'カレンダー' },
];

function NavGroup({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <section className="nav-group" aria-label={title}>
      <h2 className="nav-group-title">{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item.target}>
            <NavLink target={item.target} label={item.label} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** コマンドパレットに出さない操作 */
const PALETTE_EXCLUDED: readonly KeyAction[] = ['palette.open', 'list.next', 'list.prev', 'escape'];

/** 3ペインの枠（DESIGN.md 3章）。メインと詳細ペインは、各画面が PageLayout で置く */
export function AppShell() {
  const navigate = useNavigate();
  const router = useRouter();
  // ブラウザの通知をクリックしたときに開く画面（FR-N05）。パスはサーバーが決めた画面のもの
  const openPath = useCallback((path: string) => router.history.push(path), [router]);
  // 他のタブとサーバーからの変更を受け取る（ADR-0008）
  useRealtimeSync(openPath);
  // ブラウザの通知の許可の状態を、サーバーに知らせる（サーバーが通知の出し方を選ぶため、FR-N05）
  useEffect(() => {
    reportBrowserPermission().catch((e: unknown) => {
      console.warn('ブラウザの通知の許可の状態を、サーバーに知らせられませんでした', e);
    });
  }, []);
  const go = (to: () => Promise<void>) => {
    to();
    return true;
  };
  // コマンドパレット（FR-U02）とショートカットの一覧（FR-U03）。開いたときの、今の画面で使える操作から作る
  const [overlay, setOverlay] = useState<{
    kind: 'palette' | 'help';
    commands: KeyCommand[];
  } | null>(null);
  // 閉じたら、開く前にフォーカスがあった場所へ戻す（操作を実行したときは、操作が決めた場所に任せる）
  const returnFocus = useRef<HTMLElement | null>(null);
  const open = (kind: 'palette' | 'help') => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const actions = availableActions();
    // パレットには、開く操作そのものと、選択の移動や解除のような、その場で押すキーは出さない
    if (kind === 'palette') for (const a of PALETTE_EXCLUDED) actions.delete(a);
    setOverlay({ kind, commands: commandsFor(actions) });
    return true;
  };
  const close = () => {
    setOverlay(null);
    returnFocus.current?.focus();
  };
  const run = (action: KeyAction) => {
    setOverlay(null);
    runAction(action);
  };

  // どの画面でも使えるキー（DESIGN.md 5.1）
  useKeyBindings({
    'palette.open': () => open('palette'),
    'help.open': () => open('help'),
    'nav.today': () => go(() => navigate({ to: '/' })),
    'nav.morning': () => go(() => navigate({ to: '/morning' })),
    'nav.reflection': () =>
      go(() => navigate({ to: '/reflection/{-$day}', params: { day: undefined } })),
    'nav.backlog': () => go(() => navigate({ to: '/backlog' })),
    'nav.timeline': () => go(() => navigate({ to: '/timeline' })),
    'nav.calendar': () =>
      go(() =>
        navigate({
          to: '/calendar/$ym/{-$day}',
          params: { ym: toBusinessDay(new Date(), DAY_OPTIONS).slice(0, 7), day: undefined },
        }),
      ),
    'task.new': () => {
      const input = document.querySelector<HTMLInputElement>('[data-add-task] input');
      if (input === null) return false;
      input.focus();
      return true;
    },
  });
  return (
    <div className="shell">
      <nav className="pane pane-sidebar glass-1" aria-label="画面">
        <div className="brand">
          <Mame mood="good" size={26} label="mymind" />
          <span className="brand-name">mymind</span>
        </div>
        <NavGroup title="毎日" items={DAILY} />
        <NavGroup title="一覧" items={LISTS} />
        <div className="sidebar-spacer" />
        {/* 設定（Figma「PC/設定」）。ショートカットは割り当てない */}
        <ul className="nav-group" aria-label="その他">
          <li>
            <Link
              to="/settings"
              className="nav-item"
              activeProps={{ className: 'nav-item is-active', 'aria-current': 'page' as const }}
            >
              <span className="nav-dot" aria-hidden="true" />
              <span className="nav-label">設定</span>
            </Link>
          </li>
        </ul>
        <ul className="sidebar-hints" aria-label="ショートカット">
          {SIDEBAR_HINTS.map((h) => (
            <li key={h.label}>
              <span>{h.label}</span>
              <Kbd>{h.keys.join(' ')}</Kbd>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
      <NotificationBanner />
      {overlay?.kind === 'palette' && (
        <CommandPalette commands={overlay.commands} onRun={run} onClose={close} />
      )}
      {overlay?.kind === 'help' && <ShortcutHelp commands={overlay.commands} onClose={close} />}
    </div>
  );
}
