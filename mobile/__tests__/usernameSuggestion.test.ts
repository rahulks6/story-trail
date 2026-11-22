import { cleanUsernameInput, usernameFromName, withDigits } from "../src/utils/usernameSuggestion";

test("a username from a shared name: Latin letters and digits joined by dots", () => {
  expect(usernameFromName("Rahul Sharma")).toBe("rahul.sharma");
  expect(usernameFromName("  Priya  K. Patil ")).toBe("priya.k.patil");
  expect(usernameFromName("José Álvarez")).toBe("jose.alvarez");
  expect(usernameFromName("राहुल")).toBe("");
  expect(usernameFromName("Al")).toBe("");
  expect(usernameFromName("Venkatanarasimharajuvaripeta Srinivasan").length).toBeLessThanOrEqual(24);
});

test("typed usernames lose spaces and capitals; a taken suggestion gets three digits within 30 characters", () => {
  expect(cleanUsernameInput(" Rahul_S ")).toBe("rahul_s");
  expect(withDigits("rahul.sharma", () => 0.5)).toBe("rahul.sharma550");
  expect(withDigits("a".repeat(30), () => 0)).toHaveLength(30);
});
