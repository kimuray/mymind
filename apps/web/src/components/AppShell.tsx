import { toBusinessDay } from '@mymind/domain';
import { Link, Outlet } from '@tanstack/react-router';
import { NAVIGATION_KEYS, type NavigationTarget, SIDEBAR_HINTS } from '../keymap';
import { Kbd } from './Kbd';
import { Mame } from './Mame';

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

/** 3ペインの枠（DESIGN.md 3章）。メインと詳細ペインは、各画面が PageLayout で置く */
export function AppShell() {
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
    </div>
  );
}
