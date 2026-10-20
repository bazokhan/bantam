import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Boxes,
  Braces,
  ChevronDown,
  Coins,
  CreditCard,
  Gamepad2,
  Gauge,
  Gift,
  LogOut,
  Menu,
  Moon,
  Package,
  Plug,
  ScrollText,
  Search,
  Settings,
  ShoppingCart,
  Sun,
  Trophy,
  Users,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { GameSummary } from "@/lib/types";

// Links that belong to the game the operator is working in. They lead the
// sidebar, the way an app-scoped console leads with the app's own surfaces.
const GAME_NAV = [
  { to: "/games/$gameId", suffix: "", label: "Overview", icon: Gauge },
  { to: "/games/$gameId/boards", suffix: "/boards", label: "Leaderboards", icon: Trophy },
  { to: "/games/$gameId/players", suffix: "/players", label: "Players", icon: Users },
  { to: "/games/$gameId/runs", suffix: "/runs", label: "Runs", icon: Activity },
  { to: "/games/$gameId/flags", suffix: "/flags", label: "Feature flags", icon: Boxes },
  {
    to: "/games/$gameId/economy/currencies",
    suffix: "/economy/currencies",
    label: "Currencies",
    icon: Coins,
  },
  { to: "/games/$gameId/economy/items", suffix: "/economy/items", label: "Items", icon: Package },
  {
    to: "/games/$gameId/economy/offers",
    suffix: "/economy/offers",
    label: "Offers",
    icon: ShoppingCart,
  },
  {
    to: "/games/$gameId/economy/rewards",
    suffix: "/economy/rewards",
    label: "Rewards",
    icon: Gift,
  },
  {
    to: "/games/$gameId/economy/iap",
    suffix: "/economy/iap",
    label: "IAP products",
    icon: CreditCard,
  },
] as const;

// Links that belong to the deployment rather than to one game.
const PLATFORM_NAV = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/games", label: "All games", icon: Gamepad2 },
  { to: "/adapters", label: "Adapters", icon: Plug },
  { to: "/health", label: "Health", icon: Activity },
  { to: "/audit", label: "Audit", icon: ScrollText },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

export interface AdminUser {
  id: string;
  username: string;
}

export function DashboardShell({
  children,
  user,
  games,
  selectedGameId,
  onSelectGame,
  onLogout,
}: {
  children: ReactNode;
  user: AdminUser;
  games: GameSummary[];
  selectedGameId: string | null;
  onSelectGame: (gameId: string | null) => void;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem("bantam-admin-theme");
    return stored ? stored === "dark" : true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("bantam-admin-theme", dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const closeDrawer = () => setMobileOpen(false);

  // The route is the source of truth for which game is in context, so a deep
  // link into a game shows that game in the switcher and lights up its links.
  // The stored selection is only the fallback for pages without a game.
  const routeParams = useParams({ strict: false });
  const routeGameId = routeParams.gameId ?? null;
  const gameId = routeGameId ?? selectedGameId;

  useEffect(() => {
    if (routeGameId && routeGameId !== selectedGameId) onSelectGame(routeGameId);
  }, [routeGameId, selectedGameId, onSelectGame]);

  const selectedGame = useMemo(
    () => games.find((game) => game.id === gameId) ?? null,
    [games, gameId],
  );

  const platformItems = PLATFORM_NAV.map((item) => ({
    ...item,
    active: item.to === "/" ? pathname === "/" : pathname === item.to,
  }));

  const gameItems = GAME_NAV.map((item) => ({
    ...item,
    active: gameId
      ? pathname === `/games/${gameId}${item.suffix}` ||
        // the economy index renders the currencies table, so it lights up there too
        (item.suffix === "/economy/currencies" && pathname === `/games/${gameId}/economy`)
      : false,
  }));

  const openGame = (id: string | null) => {
    onSelectGame(id);
    if (id) void navigate({ to: "/games/$gameId", params: { gameId: id } });
    else void navigate({ to: "/games" });
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background text-foreground">
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
            <Link to="/" className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
                <Gamepad2 className="size-4" />
              </span>
              <div>
                <div className="text-sm font-semibold">Bantam</div>
                <div className="text-[10px] text-muted-foreground">Game services console</div>
              </div>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(false)}
            >
              <X />
            </Button>
          </div>

          <div className="border-b border-sidebar-border p-3">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-auto w-full justify-between px-2.5 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="grid size-7 shrink-0 place-items-center rounded bg-accent font-mono text-[10px] font-bold text-accent-foreground">
                      {selectedGame ? selectedGame.id.slice(0, 2).toUpperCase() : "--"}
                    </span>
                    <span className="truncate text-sm">
                      {selectedGame ? selectedGame.displayName : "Select a game"}
                    </span>
                  </div>
                  <ChevronDown className="size-4 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Game</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => openGame(null)}>
                  No game selected
                </DropdownMenuItem>
                {games.length === 0 ? (
                  <DropdownMenuItem disabled>No games loaded</DropdownMenuItem>
                ) : null}
                {games.map((game) => (
                  <DropdownMenuItem key={game.id} onSelect={() => openGame(game.id)}>
                    <span className="truncate">{game.displayName}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {game.id}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <nav className="flex-1 overflow-y-auto p-2" aria-label="Primary">
            {gameId ? (
              gameItems.map((item) => (
                <Link
                  key={item.suffix || "overview"}
                  to={item.to}
                  params={{ gameId }}
                  onClick={closeDrawer}
                  className={cn(
                    "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    item.active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              ))
            ) : (
              <Link
                to="/games"
                onClick={closeDrawer}
                className="mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
              >
                <Gamepad2 className="size-4 shrink-0" />
                Pick a game
              </Link>
            )}

            <div className="mt-5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Deployment
            </div>
            <div className="mt-1">
              {platformItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={closeDrawer}
                  className={cn(
                    "mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                    item.active
                      ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
                  )}
                >
                  <item.icon className="size-4 shrink-0" />
                  {item.label}
                </Link>
              ))}
            </div>
          </nav>

          <div className="border-t border-sidebar-border p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2.5 text-muted-foreground"
              onClick={() => setDark((value) => !value)}
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {dark ? "Light mode" : "Dark mode"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2.5 text-muted-foreground"
                >
                  <span className="grid size-6 place-items-center rounded-full bg-primary/15 font-mono text-[10px] font-bold text-primary">
                    {user.username.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="truncate">{user.username}</span>
                  <ChevronDown className="ml-auto size-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuLabel>Signed in as {user.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void onLogout()}>
                  <LogOut />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {mobileOpen ? (
          <button
            type="button"
            aria-label="Close navigation"
            className="fixed inset-0 z-30 bg-black/60 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        ) : null}

        <div className="lg:pl-64">
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <Menu />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden w-72 justify-start gap-2 text-muted-foreground sm:flex"
              onClick={() => setPaletteOpen(true)}
            >
              <Search />
              <span className="flex-1 text-left">Search…</span>
              <kbd className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]">
                ⌘K
              </kbd>
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" onClick={() => setDark((value) => !value)}>
                    {dark ? <Sun /> : <Moon />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle theme</TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                className="sm:hidden"
                onClick={() => setPaletteOpen(true)}
                aria-label="Open command palette"
              >
                <Search />
              </Button>
            </div>
          </header>
          <main className="px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-[1500px]">{children}</div>
          </main>
        </div>

        <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <CommandInput placeholder="Jump to a page or game…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Deployment">
              {platformItems.map((item) => (
                <CommandItem
                  key={item.to}
                  value={`page ${item.label}`}
                  onSelect={() => {
                    void navigate({ to: item.to });
                    setPaletteOpen(false);
                  }}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {selectedGame ? (
              <CommandGroup heading={selectedGame.displayName}>
                {gameItems.map((item) => (
                  <CommandItem
                    key={item.suffix || "overview"}
                    value={`tab ${item.label}`}
                    onSelect={() => {
                      if (gameId) void navigate({ to: item.to, params: { gameId } });
                      setPaletteOpen(false);
                    }}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
            <CommandSeparator />
            <CommandGroup heading="Games">
              {games.length === 0 ? (
                <CommandItem disabled>No games loaded</CommandItem>
              ) : (
                games.map((game) => (
                  <CommandItem
                    key={game.id}
                    value={`game ${game.id} ${game.displayName}`}
                    onSelect={() => {
                      openGame(game.id);
                      setPaletteOpen(false);
                    }}
                  >
                    <Braces className="size-4" />
                    {game.displayName}
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {game.id}
                    </span>
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </CommandList>
        </CommandDialog>

        <Toaster />
      </div>
    </TooltipProvider>
  );
}

export async function loadGames(): Promise<GameSummary[]> {
  return api.games();
}
