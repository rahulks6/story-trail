import { t } from "../i18n";
/** Mirrors the server's length/identity rules so most problems are caught before a round trip. */
export function newPasswordProblem(password: string, email: string, username = ""): string | undefined {
  if (password.length < 8) return t("passwordRules.useAtLeast8Characters");
  if (password.length > 200) return t("passwordRules.thatPasswordIsTooLong");
  if (email && password.toLowerCase() === email.toLowerCase()) return t("passwordRules.dontUseYourEmailAddress");
  if (username && password.toLowerCase() === username.toLowerCase()) return t("passwordRules.dontUseYourUsernameAs");
  return undefined;
}
