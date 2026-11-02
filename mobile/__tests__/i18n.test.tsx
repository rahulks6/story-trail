/**
 * The app's languages (src/i18n): every English key is translated into Hindi and Marathi with the
 * same placeholders, text is filled in and pluralized per language, numbers and times follow the
 * language, and switching in Settings > Language re-renders the app and tells the server.
 */
import React from "react";
import { Modal, NativeModules, Platform, Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { en } from "../src/i18n/en";
import { hi } from "../src/i18n/hi";
import { mr } from "../src/i18n/mr";
import { deviceLanguage, formatNumber, getLanguage, initLanguage, pluralCategory, setLanguageForTests, t, useT } from "../src/i18n";
import { topicLabel } from "../src/i18n/names";
import { richText } from "../src/i18n/rich";
import { formatCount } from "../src/utils/formatCount";
import { timeAgo } from "../src/utils/serverTime";
import { SettingsScreen } from "../src/screens/profile/SettingsScreen";
import { useLocaleSync } from "../src/state/localeSync";
import * as usersApi from "../src/api/users";

const mockAuth = {
  status: "signedIn",
  user: { id: "u-me", username: "me", isPrivate: false, locale: "en" } as { id: string; username: string; isPrivate: boolean; locale?: string },
  accessToken: "token",
  logout: jest.fn(),
  applyProfile: jest.fn(),
};
jest.mock("../src/state/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("../src/state/invites", () => ({ shareInvite: jest.fn() }));
jest.mock("../src/api/users", () => ({ updateMyProfile: jest.fn(async () => ({ user: {} })), listFollowRequests: jest.fn(async () => ({ requests: [] })) }));
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return { ...jest.requireActual("@react-navigation/native"), useFocusEffect: (effect: () => void) => React.useEffect(effect, []) };
});
const api = usersApi as jest.Mocked<typeof usersApi>;

type Entry = string | { one?: string; other: string };
const holes = (s: string) => [...s.matchAll(/\{\w+\}|<\/?\w+>/g)].map((m) => m[0]).sort();
const forms = (e: Entry) => (typeof e === "string" ? [e] : [e.one ?? "", e.other]);
const catalogues = { hi, mr } as Record<string, Record<string, Entry>>;
const english = en as unknown as Record<string, Entry>;

afterEach(() => {
  setLanguageForTests("en");
  jest.clearAllMocks();
});

describe("catalogues", () => {
  test.each(["hi", "mr"])("%s has every English key and nothing else", (lang) => {
    expect(Object.keys(catalogues[lang]!).sort()).toEqual(Object.keys(english).sort());
  });

  test.each(["hi", "mr"])("%s keeps each entry's placeholders and marked parts, and its plurals", (lang) => {
    const problems: string[] = [];
    for (const [key, source] of Object.entries(english)) {
      const translated = catalogues[lang]![key]!;
      if (typeof source === "string") {
        if (typeof translated !== "string") problems.push(`${key}: should be a string`);
        else if (holes(translated).join() !== holes(source).join()) problems.push(`${key}: ${holes(source)} vs ${holes(translated)}`);
      } else {
        if (typeof translated === "string" || !translated.one || !translated.other) { problems.push(`${key}: needs one and other`); continue; }
        if (holes(translated.other).join() !== holes(source.other).join()) problems.push(`${key}: ${holes(source.other)} vs ${holes(translated.other)}`);
      }
      if (forms(translated).some((f) => !f.trim())) problems.push(`${key}: empty`);
    }
    expect(problems).toEqual([]);
  });

  test.each(["hi", "mr"])("%s is written in Devanagari, apart from brand, formats and codes", (lang) => {
    // English left as it is only where every language writes it so.
    const same = Object.keys(english).filter((key) => JSON.stringify(catalogues[lang]![key]) === JSON.stringify(english[key]) && /[A-Za-z]{2,}/.test(forms(english[key]!).join(" ").replace(/\{\w+\}/g, "")));
    expect(same.sort()).toEqual(["login.youExampleCom", "signup.ddMmYyyy", "storyShareCard.katkeeComUUsername", ...(lang === "hi" ? ["verification.id"] : [])].sort());
  });

  test("Katkee is never translated", () => {
    for (const lang of ["hi", "mr"]) {
      for (const [key, source] of Object.entries(english)) {
        if (forms(source).some((f) => f.includes("Katkee"))) expect([key, forms(catalogues[lang]![key]!).every((f) => f.includes("Katkee"))]).toEqual([key, true]);
      }
    }
  });
});

describe("t", () => {
  test("fills placeholders in the current language", () => {
    expect(t("activity.nameLikedYourStory", { name: "@asha" })).toBe("@asha liked your Story.");
    setLanguageForTests("hi");
    expect(t("activity.nameLikedYourStory", { name: "@asha" })).toBe("@asha ने आपकी स्टोरी लाइक की।");
    setLanguageForTests("mr");
    expect(t("activity.nameLikedYourStory", { name: "@asha" })).toBe("@asha यांनी तुमची स्टोरी लाईक केली.");
  });

  test("picks the plural form from count, by each language's rules", () => {
    expect(t("profileHeader.followersSpoken", { count: 1 })).toBe("1 follower");
    expect(t("profileHeader.followersSpoken", { count: 0 })).toBe("0 followers");
    expect(t("profileHeader.followersSpoken", { count: 12_345 })).toBe("12,345 followers");
    setLanguageForTests("hi");
    // Hindi's "one" covers 0 and 1.
    expect(t("time.weeksAgo", { count: 1 })).toBe("1 हफ़्ता पहले");
    expect(t("time.weeksAgo", { count: 3 })).toBe("3 हफ़्ते पहले");
    expect(t("profileHeader.followersSpoken", { count: 1_23_456 })).toBe("1,23,456 फ़ॉलोअर्स");
    setLanguageForTests("mr");
    expect(t("time.hoursAgo", { count: 1 })).toBe("1 तासापूर्वी");
    expect(t("time.hoursAgo", { count: 5 })).toBe("5 तासांपूर्वी");
  });

  test("plural rules hold without Intl.PluralRules (Hermes may not have it)", () => {
    const original = Intl.PluralRules;
    // A fresh module, so its cache of rules is empty.
    jest.isolateModules(() => {
      (Intl as { PluralRules?: unknown }).PluralRules = undefined;
      try {
        const fresh = require("../src/i18n") as typeof import("../src/i18n");
        expect([0, 1, 2].map((n) => fresh.pluralCategory(n, "hi"))).toEqual(["one", "one", "other"]);
        expect([0, 1, 2].map((n) => fresh.pluralCategory(n, "mr"))).toEqual(["other", "one", "other"]);
        expect([0, 1, 2].map((n) => fresh.pluralCategory(n, "en"))).toEqual(["other", "one", "other"]);
      } finally {
        (Intl as { PluralRules: unknown }).PluralRules = original;
      }
    });
    expect(pluralCategory(1, "en")).toBe("one");
  });

  test("leaves an unknown placeholder visible rather than dropping text", () => {
    expect(t("activity.nameLikedYourStory", {} as { name: string })).toBe("{name} liked your Story.");
  });

  test("marked parts render where each language puts them", () => {
    setLanguageForTests("hi");
    const parts = richText(t("verifyEmail.weSentACodeTo", { email: "a@b.in" }), { email: (e) => `[${e}]` });
    expect(parts.map((p) => (React.isValidElement(p) ? (p.props as { children: string }).children : p)).join("")).toBe("हमने [a@b.in] पर 6 अंकों का कोड भेजा है।");
  });
});

describe("numbers, counts and times", () => {
  test("Indian grouping with Latin digits in Hindi and Marathi", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567, "hi")).toBe("12,34,567");
    expect(formatNumber(1234567, "mr")).toBe("12,34,567");
  });

  test("profile counts use हज़ार / लाख / करोड़", () => {
    expect([9_999, 12_345, 1_250_000].map(formatCount)).toEqual(["9,999", "12.3K", "1.2M"]);
    setLanguageForTests("hi");
    expect([9_999, 12_345, 1_23_456, 2_50_00_000].map(formatCount)).toEqual(["9,999", "12.3 हज़ार", "1.2 लाख", "2.5 करोड़"]);
    setLanguageForTests("mr");
    expect([12_345, 2_50_00_000].map(formatCount)).toEqual(["12.3 हजार", "2.5 कोटी"]);
  });

  test("relative times", () => {
    const now = Date.parse("2026-11-02T12:00:00Z");
    const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
    expect([0.5, 5, 180, 2 * 1440, 21 * 1440].map((m) => timeAgo(at(m), now))).toEqual(["just now", "5m ago", "3h ago", "2d ago", "3w ago"]);
    expect(timeAgo(at(180), now, "short")).toBe("3h");
    setLanguageForTests("hi");
    expect([0.5, 5, 60, 2 * 1440].map((m) => timeAgo(at(m), now))).toEqual(["अभी-अभी", "5 मिनट पहले", "1 घंटा पहले", "2 दिन पहले"]);
    expect(timeAgo(at(180), now, "short")).toBe("3 घं॰");
    setLanguageForTests("mr");
    expect(timeAgo(at(2 * 1440), now)).toBe("2 दिवसांपूर्वी");
  });

  test("stored values stay English; only their names are translated", () => {
    setLanguageForTests("hi");
    expect(topicLabel("Cricket")).toBe("क्रिकेट");
    expect(topicLabel("Something new")).toBe("Something new");
  });
});

describe("choosing the language", () => {
  const settings = NativeModules.SettingsManager as { settings?: Record<string, unknown> } | undefined;
  const original = settings?.settings;
  afterEach(() => {
    if (settings) settings.settings = original;
  });

  test("follows the phone (hi, mr, else English) until someone picks one", async () => {
    const set = (locale: string) => {
      if (Platform.OS === "ios") NativeModules.SettingsManager = { settings: { AppleLanguages: [locale] } };
      else NativeModules.I18nManager = { ...NativeModules.I18nManager, localeIdentifier: locale };
    };
    set("hi_IN");
    expect(deviceLanguage()).toBe("hi");
    set("mr-IN");
    expect(deviceLanguage()).toBe("mr");
    set("ta_IN");
    expect(deviceLanguage()).toBe("en");
    set("mr-IN");
    await AsyncStorage.removeItem("katkee.language.v1");
    expect(await initLanguage()).toBe("mr");
    // A saved choice wins over the phone.
    await AsyncStorage.setItem("katkee.language.v1", "hi");
    expect(await initLanguage()).toBe("hi");
    await AsyncStorage.removeItem("katkee.language.v1");
  });

  test("a component using useT re-renders in the new language", async () => {
    function Label(): React.JSX.Element {
      const tr = useT();
      return <Text>{tr("settings.language")}</Text>;
    }
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<Label />); });
    expect(tree.root.findByType(Text).props.children).toBe("Language");
    await act(async () => setLanguageForTests("mr"));
    expect(tree.root.findByType(Text).props.children).toBe("भाषा");
    await act(async () => tree.unmount());
  });

  test("Settings > Language lists each language in its own script, switches, and saves the choice", async () => {
    const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <SafeAreaProvider initialMetrics={metrics}>
          <SettingsScreen {...({ navigation: { navigate: jest.fn() }, route: { key: "Settings", name: "Settings" } } as unknown as React.ComponentProps<typeof SettingsScreen>)} />
        </SafeAreaProvider>,
      );
    });
    const pressable = (label: string) => tree.root.findAll((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === label)[0];
    await act(async () => pressable("Language")!.props.onPress());
    for (const name of ["English", "हिन्दी", "मराठी"]) expect(pressable(name)).toBeDefined();
    await act(async () => pressable("हिन्दी")!.props.onPress());
    // The sheet runs the choice once it has slid away.
    const sheet = tree.root.findAllByType(Modal).find((m) => m.props.visible === false && typeof m.props.onDismiss === "function")!;
    await act(async () => { sheet.props.onDismiss(); await Promise.resolve(); });
    expect(getLanguage()).toBe("hi");
    expect(await AsyncStorage.getItem("katkee.language.v1")).toBe("hi");
    // The screen re-renders in Hindi.
    expect(pressable("भाषा")).toBeDefined();
    await act(async () => tree.unmount());
    await AsyncStorage.removeItem("katkee.language.v1");
  });

  test("the account's locale follows the app's language, for pushes and emails", async () => {
    function Sync(): null {
      useLocaleSync();
      return null;
    }
    let tree!: ReactTestRenderer;
    await act(async () => { tree = create(<Sync />); });
    // Already English on the server: nothing to send.
    expect(api.updateMyProfile).not.toHaveBeenCalled();
    await act(async () => setLanguageForTests("mr"));
    expect(api.updateMyProfile).toHaveBeenCalledWith({ locale: "mr" }, "token");
    await act(async () => tree.unmount());
  });
});
