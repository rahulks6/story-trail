import { BIRTH_DATE_MESSAGES, MINIMUM_AGE, birthDateFieldProblem, birthDateProblem, birthDateToIso, formatBirthDateInput, todayInIndia } from "../src/utils/birthDate";

// The app's copy of the server's age rule (backend/src/modules/auth/age.ts and its tests).
describe("date of birth", () => {
  test("is typed as DD/MM/YYYY and sent as YYYY-MM-DD", () => {
    expect(["1", "15", "150", "1505", "15051", "15051995", "150519951", "15/05/1995", "15-05-1995", "ab15c05"].map(formatBirthDateInput))
      .toEqual(["1", "15", "15/0", "15/05", "15/05/1", "15/05/1995", "15/05/1995", "15/05/1995", "15/05/1995", "15/05"]);
    expect(birthDateToIso("15/05/1995")).toBe("1995-05-15");
    expect(birthDateToIso("15/05/199")).toBeNull();
    expect(birthDateToIso("")).toBeNull();
  });

  test("is 18 or older on today's date in India", () => {
    expect(MINIMUM_AGE).toBe(18);
    const lastSecond = Date.parse("2026-10-12T18:29:59Z"), midnight = Date.parse("2026-10-12T18:30:00Z");
    expect([todayInIndia(lastSecond), todayInIndia(midnight)]).toEqual(["2026-10-12", "2026-10-13"]);
    expect(birthDateProblem("2008-10-13", lastSecond)).toBe(BIRTH_DATE_MESSAGES.tooYoung);
    expect(birthDateProblem("2008-10-13", midnight)).toBeUndefined();
    expect(birthDateProblem("2008-02-29", Date.parse("2026-02-28T06:00:00Z"))).toBe(BIRTH_DATE_MESSAGES.tooYoung);
    expect(birthDateProblem("2008-02-29", Date.parse("2026-03-01T06:00:00Z"))).toBeUndefined();
  });

  test("must be a real date from 1900 to today", () => {
    const now = Date.parse("2026-10-13T06:00:00Z");
    expect(birthDateProblem(null, now)).toBe(BIRTH_DATE_MESSAGES.required);
    for (const bad of ["2001-02-30", "2001-13-01", "2001-00-10", "2003-02-29", "1899-12-31", "2026-10-14"]) {
      expect([bad, birthDateProblem(bad, now)]).toEqual([bad, BIRTH_DATE_MESSAGES.invalid]);
    }
    expect(birthDateProblem("1900-01-01", now)).toBeUndefined();
    expect(birthDateFieldProblem("15/05", now)).toBeUndefined();
    expect(birthDateFieldProblem("31/04/1990", now)).toBe(BIRTH_DATE_MESSAGES.invalid);
  });
});
