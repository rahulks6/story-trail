export const previewUser = {
  id: "0f3c2b1a-1111-4222-8333-444455556666", username: "rahul.creates", email: "rahul@example.com", displayName: "Rahul Kulkarni",
  bio: "Street food, sunsets and slow travel across Maharashtra. New Stories every evening.", avatarMediaId: "a_me",
  interests: ["Travel", "Street food", "Photography"], isPrivate: false,
};
export function useAuth() {
  return { status: "signedIn", user: previewUser, accessToken: "preview-token", applyProfile() {}, logout() {}, deleteAccount() {} };
}
