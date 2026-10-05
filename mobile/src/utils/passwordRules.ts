/** Mirrors the server's length/identity rules so most problems are caught before a round trip. */
export function newPasswordProblem(password: string, email: string): string | undefined {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 200) return "That password is too long.";
  if (email && password.toLowerCase() === email.toLowerCase()) return "Don't use your email address as your password.";
  return undefined;
}
