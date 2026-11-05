import React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import * as RNFS from "@dr.pogodin/react-native-fs";
import Share from "react-native-share";
import * as usersApi from "../src/api/users";
import { DataExportScreen } from "../src/screens/profile/DataExportScreen";

jest.mock("../src/state/AuthContext", () => ({ useAuth: () => ({ accessToken: "token", user: { id: "me", username: "rahul" } }) }));
jest.mock("@react-navigation/native", () => ({ ...jest.requireActual("@react-navigation/native"), useFocusEffect: (effect: () => void) => require("react").useEffect(effect, []) }));

let tree: ReactTestRenderer;
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(""));
const button = (label: string) => tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.findAllByType(Text).some((t) => t.props.children === label));
const base = { id: "e1", createdAt: "2026-11-05T10:00:00Z", readyAt: null, expiresAt: "2026-11-12T10:00:00Z", byteSize: 0, downloadUrl: null };

afterEach(async () => { await act(async () => tree?.unmount()); jest.restoreAllMocks(); jest.useRealTimers(); });

test("asks for a copy, waits while it's made, then saves it with the phone's share sheet", async () => {
  jest.useFakeTimers();
  const get = jest.spyOn(usersApi, "getDataExport").mockResolvedValue({ export: null });
  const ask = jest.spyOn(usersApi, "requestDataExport").mockResolvedValue({ export: { ...base, status: "queued" } });
  await act(async () => { tree = create(<DataExportScreen />); });
  await flush();
  expect(texts()).toContain("Every Story you posted, with its photo or video");
  await act(async () => button("Request a download").props.onPress());
  await flush();
  expect(ask).toHaveBeenCalledWith("token");
  expect(texts().some((t) => t.startsWith("We're making your file"))).toBe(true);

  get.mockResolvedValue({ export: { ...base, status: "ready", readyAt: "2026-11-05T10:02:00Z", byteSize: 4_200_000, downloadUrl: "/api/v1/users/me/data-export/e1/file" } });
  await act(async () => { jest.advanceTimersByTime(5000); });
  await flush();
  expect(texts().some((t) => t.startsWith("Your file is ready (4.2 MB)"))).toBe(true);
  await act(async () => button("Save the file").props.onPress());
  await flush();
  expect((RNFS.downloadFile as jest.Mock).mock.calls.at(-1)![0]).toMatchObject({ fromUrl: expect.stringMatching(/\/api\/v1\/users\/me\/data-export\/e1\/file$/), headers: { Authorization: "Bearer token" } });
  expect((Share.open as jest.Mock).mock.calls.at(-1)![0]).toMatchObject({ type: "application/zip" });
  expect(RNFS.unlink).toHaveBeenCalled();
});

test("a failed one can be asked for again", async () => {
  jest.spyOn(usersApi, "getDataExport").mockResolvedValue({ export: { ...base, status: "failed" } });
  await act(async () => { tree = create(<DataExportScreen />); });
  await flush();
  expect(texts()).toContain("We couldn't make your file. Please try again.");
  expect(button("Request a download")).toBeTruthy();
});
