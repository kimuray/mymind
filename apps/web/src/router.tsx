import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from './components/AppShell';
import { BacklogPage } from './pages/BacklogPage';
import { CalendarPage } from './pages/CalendarPage';
import { MorningPage } from './pages/MorningPage';
import { ReflectionPage } from './pages/ReflectionPage';
import { SettingsPage } from './pages/SettingsPage';
import { TimelinePage } from './pages/TimelinePage';
import { TodayPage } from './pages/TodayPage';
import { viewTransitionTypes } from './pageTransition';
import { MameGalleryPage } from './routes/pages';

// 画面の URL（#20 の暫定決定）。ルートはコードで定義する（ADR-0012）

const rootRoute = createRootRoute({ component: AppShell });

const todayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: TodayPage,
});
const morningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/morning',
  component: MorningPage,
});
const reflectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reflection/{-$day}',
  component: function Reflection() {
    const { day } = reflectionRoute.useParams();
    return <ReflectionPage day={day} />;
  },
});
const backlogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backlog',
  component: BacklogPage,
});
const timelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/timeline',
  component: TimelinePage,
});
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar/$ym/{-$day}',
  component: function Calendar() {
    const { ym, day } = calendarRoute.useParams();
    return <CalendarPage ym={ym} day={day} />;
  },
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});
const mameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/mame',
  component: MameGalleryPage,
});

const routeTree = rootRoute.addChildren([
  todayRoute,
  morningRoute,
  reflectionRoute,
  backlogRoute,
  timelineRoute,
  calendarRoute,
  settingsRoute,
  mameRoute,
]);

// 画面を移るときは View Transitions で中身を切り替える（DESIGN.md 2.9）。対応していないブラウザでは動きなしで同じ結果になる。
// 同じ画面の中の移動では切り替えない
export const router = createRouter({
  routeTree,
  defaultViewTransition: {
    types: ({ fromLocation, toLocation }) =>
      viewTransitionTypes(fromLocation?.pathname, toLocation.pathname),
  },
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
