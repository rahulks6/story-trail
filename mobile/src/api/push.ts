import { apiPost } from "./client";

/** Mirrors backend/src/modules/push/push.routes.ts. */
export interface PushDevice {
  provider: "fcm" | "apns";
  platform: "ios" | "android";
  token: string;
  appVersion?: string;
  locale?: string;
}

/** Registers (or refreshes) this device for the signed-in account. */
export function registerPushDevice(device: PushDevice, accessToken: string): Promise<{ device: { id: string } }> {
  return apiPost("/api/v1/push/devices", device, accessToken);
}

/** Stops pushes to this device for the signed-in account (sign-out). */
export function unregisterPushDevice(device: Pick<PushDevice, "provider" | "token">, accessToken: string): Promise<void> {
  return apiPost("/api/v1/push/devices/unregister", device, accessToken);
}
