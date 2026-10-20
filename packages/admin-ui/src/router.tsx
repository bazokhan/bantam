import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { AdminProvider, useAdmin } from "@/components/dashboard/app-context";
import { DashboardShell } from "@/components/dashboard/shell";
import { AdaptersPage } from "@/components/dashboard/adapters";
import { AuditPage } from "@/components/dashboard/audit";
import { BoardsPage } from "@/components/dashboard/boards";
import { EconomyPage } from "@/components/dashboard/economy";
import { FlagsPage } from "@/components/dashboard/flags";
import { GameOverviewPage } from "@/components/dashboard/game-detail";
import { GamesPage } from "@/components/dashboard/games";
import { HealthPage } from "@/components/dashboard/health";
import { OverviewPage } from "@/components/dashboard/overview";
import { PlayersPage } from "@/components/dashboard/players";
import { RunsPage } from "@/components/dashboard/runs";
import { SettingsPage } from "@/components/dashboard/settings";

function RootLayout() {
  const { username, games, selectedGameId, setSelectedGameId, logout } = useAdmin();
  return (
    <DashboardShell
      user={{ id: "admin", username }}
      games={games}
      selectedGameId={selectedGameId}
      onSelectGame={setSelectedGameId}
      onLogout={logout}
    >
      <Outlet />
    </DashboardShell>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: OverviewPage,
});

const gamesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/games",
  component: () => <Outlet />,
});
const gamesIndexRoute = createRoute({
  getParentRoute: () => gamesRoute,
  path: "/",
  component: GamesPage,
});

const gameRoute = createRoute({
  getParentRoute: () => gamesRoute,
  path: "$gameId",
  component: () => <Outlet />,
});
const gameIndexRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "/",
  component: GameOverviewPage,
});
const boardsRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "boards",
  component: BoardsPage,
});
const playersRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "players",
  component: PlayersPage,
});
const runsRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "runs",
  component: RunsPage,
});
const flagsRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "flags",
  component: FlagsPage,
});
// The economy section is a group of pages, not one page: currencies, items,
// offers, rewards and IAP products are edited separately, so each has its own
// route and its own entry in the sidebar.
const economyRoute = createRoute({
  getParentRoute: () => gameRoute,
  path: "economy",
  component: () => <Outlet />,
});
const economyIndexRoute = createRoute({
  getParentRoute: () => economyRoute,
  path: "/",
  component: () => <EconomyPage section="currencies" />,
});
const economyCurrenciesRoute = createRoute({
  getParentRoute: () => economyRoute,
  path: "currencies",
  component: () => <EconomyPage section="currencies" />,
});
const economyItemsRoute = createRoute({
  getParentRoute: () => economyRoute,
  path: "items",
  component: () => <EconomyPage section="items" />,
});
const economyOffersRoute = createRoute({
  getParentRoute: () => economyRoute,
  path: "offers",
  component: () => <EconomyPage section="offers" />,
});
const economyRewardsRoute = createRoute({
  getParentRoute: () => economyRoute,
  path: "rewards",
  component: () => <EconomyPage section="rewards" />,
});
const economyIapRoute = createRoute({
  getParentRoute: () => economyRoute,
  path: "iap",
  component: () => <EconomyPage section="iap" />,
});

const adaptersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/adapters",
  component: AdaptersPage,
});
const healthRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/health",
  component: HealthPage,
});
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit",
  component: AuditPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  gamesRoute.addChildren([
    gamesIndexRoute,
    gameRoute.addChildren([
      gameIndexRoute,
      boardsRoute,
      playersRoute,
      runsRoute,
      flagsRoute,
      economyRoute.addChildren([
        economyIndexRoute,
        economyCurrenciesRoute,
        economyItemsRoute,
        economyOffersRoute,
        economyRewardsRoute,
        economyIapRoute,
      ]),
    ]),
  ]),
  adaptersRoute,
  healthRoute,
  auditRoute,
  settingsRoute,
]);

export const router = createRouter({
  routeTree,
  basepath: "/admin/console",
  defaultPreload: "intent",
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  return <AdminProvider>{children}</AdminProvider>;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
