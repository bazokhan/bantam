import { Link, useRouterState } from "@tanstack/react-router";
import { Boxes, Gauge, LayoutList, Trophy, Users } from "lucide-react";

import { cn } from "@/lib/utils";

const TABS = [
  { to: "/games/$gameId", suffix: "", label: "Overview", icon: Gauge },
  { to: "/games/$gameId/boards", suffix: "boards", label: "Leaderboards", icon: Trophy },
  { to: "/games/$gameId/players", suffix: "players", label: "Players", icon: Users },
  { to: "/games/$gameId/runs", suffix: "runs", label: "Runs", icon: Gauge },
  { to: "/games/$gameId/flags", suffix: "flags", label: "Feature Flags", icon: Boxes },
  { to: "/games/$gameId/economy", suffix: "economy", label: "Economy", icon: LayoutList },
] as const;

export function GameTabs({ gameId }: { gameId: string }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav className="mb-6 flex flex-wrap gap-1 border-b border-border" aria-label="Game sections">
      {TABS.map((tab) => {
        const active = pathname === `/games/${gameId}${tab.suffix}`;
        return (
          <Link
            key={tab.suffix || "overview"}
            to={tab.to}
            params={{ gameId }}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="size-3.5" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
