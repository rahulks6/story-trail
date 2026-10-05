import { apiPost } from "./client";

/** A single-use, 60-second ticket for opening the realtime connection (backend/src/realtime/realtime.routes.ts). */
export function createRealtimeTicket(accessToken: string): Promise<{ ticket: string; expiresInSeconds: number; path: string }> {
  return apiPost("/api/v1/realtime/ticket", undefined, accessToken);
}
