import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { GameSummary } from "@/lib/types";

interface AdminContextValue {
  username: string;
  games: GameSummary[];
  gamesLoading: boolean;
  selectedGameId: string | null;
  setSelectedGameId: (gameId: string | null) => void;
  refreshGames: () => Promise<void>;
  logout: () => Promise<void>;
}

const AdminContext = createContext<AdminContextValue | undefined>(undefined);

const STORAGE_KEY = "bantam-admin-game";

export function AdminProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [storedGameId, setStoredGameIdState] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  const session = useQuery({
    queryKey: ["admin-session"],
    queryFn: api.session,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const gamesQuery = useQuery({
    queryKey: ["admin-games"],
    queryFn: api.games,
    staleTime: 30_000,
    retry: false,
  });

  const games = useMemo(() => gamesQuery.data ?? [], [gamesQuery.data]);

  // A stored game that is no longer loaded must not stay selected.
  const selectedGameId =
    storedGameId && games.some((game) => game.id === storedGameId) ? storedGameId : null;

  const setSelectedGameId = useCallback((gameId: string | null) => {
    setStoredGameIdState(gameId);
    if (gameId) {
      localStorage.setItem(STORAGE_KEY, gameId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshGames = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-games"] });
  }, [queryClient]);

  const logout = useCallback(async () => {
    await api.logout();
    window.location.assign("/admin/login");
  }, []);

  const value = useMemo<AdminContextValue>(
    () => ({
      username: session.data?.admin?.username ?? "operator",
      games,
      gamesLoading: gamesQuery.isLoading,
      selectedGameId,
      setSelectedGameId,
      refreshGames,
      logout,
    }),
    [
      session.data,
      games,
      gamesQuery.isLoading,
      selectedGameId,
      setSelectedGameId,
      refreshGames,
      logout,
    ],
  );

  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin(): AdminContextValue {
  const context = useContext(AdminContext);
  if (!context) throw new Error("AdminProvider missing");
  return context;
}
