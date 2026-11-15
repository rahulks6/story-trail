import { apiGet, apiPost, apiPut } from "./client";

/** Crossed paths (backend modules/crossed-paths): off until you turn it on. */
export function getCrossedPaths(accessToken: string): Promise<{ enabled: boolean }> {
  return apiGet("/api/v1/users/me/crossed-paths", accessToken);
}

export function putCrossedPaths(enabled: boolean, accessToken: string): Promise<{ enabled: boolean }> {
  return apiPut("/api/v1/users/me/crossed-paths", { enabled }, accessToken);
}

/** A neighbourhood-sized cell (5-character geohash) while the app is open; never coordinates. */
export function postCrossedVisit(cell: string, accessToken: string): Promise<{ recorded: boolean }> {
  return apiPost("/api/v1/users/me/crossed-paths/visits", { cell }, accessToken);
}
