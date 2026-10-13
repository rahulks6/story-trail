import { avatars } from "./images";
import { previewUser } from "./auth";
const scenario = new URLSearchParams(location.search).get("screen") ?? "own";
const base = { isSelf: false, viewer: { isFollowing: false, isFollowedBy: false, hasPendingRequestFromViewer: false, hasPendingRequestFromTarget: false, isMutedByViewer: false } };
const people: Record<string, any> = {
  "rahul.creates": { ...previewUser, ...base, isSelf: true, followerCount: 1284, followingCount: 312 },
  asha_k: { ...base, id: "11111111-2222-4333-8444-555555555555", username: "asha_k", displayName: "Asha Kale", bio: "Pune food walks every weekend. Vada pav is a personality.", avatarMediaId: "a_asha", interests: ["Food", "Travel"], isPrivate: false, followerCount: 12345, followingCount: 180, viewer: { ...base.viewer, isFollowedBy: true } },
};
people["kabir.s"] = { ...base, id: "22222222-2222-4333-8444-555555555555", username: "kabir.s", displayName: "Kabir Shah", bio: "Close friends only.", avatarMediaId: "a_kabir", interests: [], isPrivate: true, followerCount: 248, followingCount: 301 };
export function avatarFileUrl(_username: string, mediaId: string | null) { return avatars[mediaId ?? ""] ?? ""; }
export async function getProfile(name: string) { return { profile: people[name] }; }
export async function followUser() { return { status: "following" }; }
export async function unfollowUser() {}
export async function muteUser() {}
export async function unmuteUser() {}
export async function blockUser() {}
export async function updateMyProfile() { return { user: previewUser }; }
export async function listFollowRequests() { return { requests: [] }; }
void scenario;
export async function checkUsername(username: string) {
  return username === previewUser.username
    ? { username, available: true, reason: "yours", message: "This is your username." }
    : { username, available: true, reason: "available", message: "Available." };
}
