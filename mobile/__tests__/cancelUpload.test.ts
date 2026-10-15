import AsyncStorage from "@react-native-async-storage/async-storage";
import * as media from "../src/api/media";
import { cancelUpload } from "../src/state/uploadQueue";

const owner = "22222222-2222-2222-2222-222222222222";
const saved = async (id: string) => JSON.parse((await AsyncStorage.getItem(`katkee.upload.v1.${owner}.${id}`)) ?? "null");
const save = (id: string, status: string, extra: object = {}) =>
  AsyncStorage.setItem(`katkee.upload.v1.${owner}.${id}`, JSON.stringify({ id, ownerId: owner, kind: "photo", mimeType: "image/jpeg", payload: {}, createdAt: "2026-10-15T06:00:00.000Z", status, uploadVersion: 2, ...extra }));

describe("stopping a Story that is sharing", () => {
  beforeEach(async () => { await AsyncStorage.clear(); });

  it("removes it, and drops the half-sent file on the server", async () => {
    const abort = jest.spyOn(media, "abortUploadSession").mockResolvedValue();
    await save("story_stopstopstopstop", "uploading", { mediaId: "m-1" });
    expect(await cancelUpload(owner, "story_stopstopstopstop", "token")).toBe(true);
    expect(abort).toHaveBeenCalledWith("m-1", "token");
    expect(await saved("story_stopstopstopstop")).toBeNull();
  });

  it("can't stop one that has posted or is being finished by the server", async () => {
    await save("story_postedpostedpost", "published", { storyId: "s-1" });
    await save("story_processingproces", "processing", { mediaId: "m-2" });
    expect(await cancelUpload(owner, "story_postedpostedpost", "token")).toBe(false);
    expect(await cancelUpload(owner, "story_processingproces", "token")).toBe(false);
    expect((await saved("story_postedpostedpost")).status).toBe("published");
    expect((await saved("story_processingproces")).status).toBe("processing");
  });
});
