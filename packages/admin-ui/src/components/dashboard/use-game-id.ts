import { useParams } from "@tanstack/react-router";

/**
 * The active game id for every game-scoped page. Read from the router match
 * without pinning to a route id, so a page can be mounted under more than
 * one path.
 */
export function useGameId(): string {
  const gameId = useOptionalGameId();
  if (!gameId) {
    throw new Error("This page requires a game id in the route.");
  }
  return gameId;
}

export function useOptionalGameId(): string | null {
  const params = useParams({ strict: false });
  return params.gameId ?? null;
}
