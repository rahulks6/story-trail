import { apiGet, apiPut } from "./client";

/** Your approximate area for Nearby Stories. Only you can read it; it is never shown to anyone. */
export interface Area {
  cell: string | null;
  timeZone: string | null;
  updatedAt: string;
}

export function getMyArea(accessToken: string): Promise<{ area: Area | null }> {
  return apiGet("/api/v1/users/me/area", accessToken);
}

/** A field left out keeps what the server has; null clears it. */
export function putMyArea(input: { cell?: string | null; timeZone?: string }, accessToken: string): Promise<{ area: Area }> {
  return apiPut("/api/v1/users/me/area", input, accessToken);
}
