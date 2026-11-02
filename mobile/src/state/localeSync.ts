import { useEffect } from "react";
import { updateMyProfile } from "../api/users";
import { useLanguage } from "../i18n";
import { useAuth } from "./AuthContext";

/**
 * Tells the server the app's language on this phone, so pushes and emails reach the person in it
 * (users.locale, migration 0070). Sent when someone signs in with a different one saved, and again
 * whenever it changes in Settings > Language. A failure is quiet: it's tried again next launch.
 */
export function useLocaleSync(): void {
  const { status, user, accessToken, applyProfile } = useAuth();
  const language = useLanguage();
  const signedIn = status === "signedIn" && !!user && !!accessToken;
  const saved = user?.locale;
  useEffect(() => {
    if (!signedIn || !accessToken || saved === language) return;
    let alive = true;
    updateMyProfile({ locale: language }, accessToken)
      .then(({ user: updated }) => { if (alive) applyProfile(updated); })
      .catch(() => undefined);
    return () => { alive = false; };
    // A new token alone (a refresh) is no reason to send it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, user?.id, saved, language]);
}
