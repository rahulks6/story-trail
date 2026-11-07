import { chatDayLabel, messageClock, messageDayKey } from "../src/utils/chatTime";

// Times in a chat: each message its time of day, and each day its line, in the phone's own time.
const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const now = new Date(2026, 10, 7, 15, 0); // Saturday 7 Nov 2026, 3 pm

test("a message shows the time it was sent", () => {
  expect(messageClock(local(2026, 11, 7, 9, 5))).toMatch(/9:05/);
  expect(messageClock(local(2026, 11, 7, 21, 40))).toMatch(/(9:40|21:40)/);
  // The API's Postgres form reads too, and an unreadable time shows nothing rather than "Invalid Date".
  expect(messageClock("2026-10-06 09:01:00+00")).not.toBe("");
  expect(messageClock("not a time")).toBe("");
});

test("each day has its line: Today, Yesterday, the weekday this week, then the date", () => {
  expect(chatDayLabel(local(2026, 11, 7, 1), now)).toBe("Today");
  expect(chatDayLabel(local(2026, 11, 6, 23), now)).toBe("Yesterday");
  expect(chatDayLabel(local(2026, 11, 3), now)).toBe("Tuesday");
  expect(chatDayLabel(local(2026, 10, 25), now)).toMatch(/25 Oct|Oct 25/);
  expect(chatDayLabel(local(2025, 12, 31), now)).toMatch(/2025/);
});

test("messages from the same day share a day; midnight starts a new one", () => {
  expect(messageDayKey(local(2026, 11, 7, 0, 1))).toBe(messageDayKey(local(2026, 11, 7, 23, 59)));
  expect(messageDayKey(local(2026, 11, 6, 23, 59))).not.toBe(messageDayKey(local(2026, 11, 7, 0, 1)));
  expect(messageDayKey(null)).toBe("");
});
