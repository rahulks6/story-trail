import React from "react";
import { Platform } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import * as RNFS from "@dr.pogodin/react-native-fs";
import { FilterStrip } from "../src/components/FilterStrip";
import { FILTER_PREVIEWS, RECIPES, applyToPixels, colorTransform, type FilterKey } from "../src/models/filterPreviews";
import { exifOrientation, uprightSteps } from "../src/utils/exifOrientation";
import { filteredPhotoUri, forgetFilteredPhoto } from "../src/utils/filterPhoto";

const g = globalThis as unknown as {
  __nitroImage: { size: { width: number; height: number }; colour: number[]; saved: Array<{ steps: unknown[]; width: number; height: number; pixels?: Uint8Array }>; fail: boolean };
};

/** The server's result for one colour (backend/src/modules/media/filters.ts does the same sum). */
function expected(key: FilterKey, rgb: number[]): number[] {
  const t = colorTransform(RECIPES[key]);
  return [0, 1, 2].map((c) => Math.round(255 * Math.min(1, Math.max(0, rgb.reduce((sum, v, i) => sum + t.matrix[c * 3 + i]! * (v / 255), t.offset[c]!)))));
}

/** A JPEG header with an EXIF orientation tag, in either byte order. */
function jpegWithOrientation(orientation: number, littleEndian: boolean): Uint8Array {
  const u16 = (v: number) => (littleEndian ? [v & 255, v >> 8] : [v >> 8, v & 255]);
  const u32 = (v: number) => (littleEndian ? [v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24] : [v >>> 24, (v >> 16) & 255, (v >> 8) & 255, v & 255]);
  const tiff = [...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)];
  const app1 = [...Array.from("Exif\0\0", (c) => c.charCodeAt(0)), ...tiff];
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255, ...app1, 0xff, 0xda, 0, 2]);
}

/** Base64 of some bytes (what RNFS.read returns). */
function base64(bytes: Uint8Array): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += abc[(n >> 18) & 63]! + abc[(n >> 12) & 63]! + (i + 1 < bytes.length ? abc[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? abc[n & 63]! : "=");
  }
  return out;
}

beforeEach(() => {
  g.__nitroImage.saved = [];
  g.__nitroImage.fail = false;
  g.__nitroImage.size = { width: 400, height: 300 };
  g.__nitroImage.colour = [200, 120, 90, 255];
  (RNFS.read as jest.Mock).mockResolvedValue("");
});

describe("filter maths", () => {
  it("leaves the picture alone for Original, and makes Mono grey", () => {
    expect(colorTransform(RECIPES.original)).toEqual({ matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], offset: [0, 0, 0] });
    const [r, gr, b] = expected("mono", [200, 120, 90]);
    expect(r).toBe(gr);
    expect(gr).toBe(b);
  });

  it("offers one filter per name, and every filter changes the picture", () => {
    expect(FILTER_PREVIEWS.map((f) => f.name.toLowerCase()).sort()).toEqual(Object.keys(RECIPES).sort());
    for (const key of Object.keys(RECIPES) as FilterKey[]) {
      if (key !== "original") expect(expected(key, [200, 120, 90])).not.toEqual([200, 120, 90]);
    }
  });

  it("gives the same colours whatever the phone's pixel layout, with padded rows and alpha left alone", () => {
    const t = colorTransform(RECIPES.vintage);
    const rgba = Uint8Array.from([200, 120, 90, 77, 30, 40, 50, 66]);
    const bgra = Uint8Array.from([90, 120, 200, 77, 50, 40, 30, 66]);
    applyToPixels(rgba, 2, 1, "RGBA", t);
    applyToPixels(bgra, 2, 1, "BGRA", t);
    expect([rgba[0], rgba[1], rgba[2]]).toEqual(expected("vintage", [200, 120, 90]));
    expect([bgra[2], bgra[1], bgra[0]]).toEqual([rgba[0], rgba[1], rgba[2]]);
    expect([rgba[3], rgba[7], bgra[3], bgra[7]]).toEqual([77, 66, 77, 66]);
    // Two rows of one RGB pixel each, padded to 4 bytes per row: the padding byte isn't touched.
    const padded = Uint8Array.from([200, 120, 90, 9, 200, 120, 90, 9]);
    applyToPixels(padded, 1, 2, "RGB", t);
    expect([padded[3], padded[7]]).toEqual([9, 9]);
    expect([padded[4], padded[5], padded[6]]).toEqual(expected("vintage", [200, 120, 90]));
  });

  it("matches the server's arithmetic exactly on every filter (the fast loop changes nothing)", () => {
    // backend/src/modules/media/filters.ts applyToPixels, as written there.
    const server = (pixels: Uint8Array, t: ReturnType<typeof colorTransform>) => {
      const table = new Float32Array(9 * 256);
      for (let k = 0; k < 9; k++) for (let v = 0; v < 256; v++) table[k * 256 + v] = ((t.matrix[k] ?? 0) * v) / 255;
      for (let i = 0; i + 2 < pixels.length; i += 3) {
        const r = pixels[i]!, gr = pixels[i + 1]!, b = pixels[i + 2]!;
        for (let ch = 0; ch < 3; ch++) {
          const v = table[ch * 768 + r]! + table[ch * 768 + 256 + gr]! + table[ch * 768 + 512 + b]! + (t.offset[ch] ?? 0);
          pixels[i + ch] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255);
        }
      }
    };
    const source = Uint8Array.from({ length: 3 * 4096 }, (_, i) => (i * 97 + (i >> 3) * 31) % 256);
    for (const key of Object.keys(RECIPES) as FilterKey[]) {
      const t = colorTransform(RECIPES[key]);
      const phone = source.slice();
      const reference = source.slice();
      applyToPixels(phone, 64, 64, "RGB", t);
      server(reference, t);
      expect(phone).toEqual(reference);
    }
  });
});

describe("photo orientation", () => {
  it("reads the EXIF orientation in either byte order, and 1 without one", () => {
    expect(exifOrientation(jpegWithOrientation(6, false))).toBe(6);
    expect(exifOrientation(jpegWithOrientation(8, true))).toBe(8);
    expect(exifOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBe(1);
    expect(exifOrientation(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
  });

  it("turns each orientation upright", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(uprightSteps)).toEqual([
      { mirror: false, rotate: 0 }, { mirror: true, rotate: 0 }, { mirror: false, rotate: 180 }, { mirror: true, rotate: 180 },
      { mirror: true, rotate: 270 }, { mirror: false, rotate: 90 }, { mirror: true, rotate: 90 }, { mirror: false, rotate: 270 },
    ]);
  });
});

describe("filtered photo preview", () => {
  const original = Platform.OS;
  afterEach(() => {
    Platform.OS = original;
  });

  it("turns an Android camera photo upright, sizes it, and applies the server's filter", async () => {
    Platform.OS = "android";
    (RNFS.read as jest.Mock).mockResolvedValue(base64(jpegWithOrientation(6, false)));
    const uri = "file:///camera/IMG_2.jpg";
    const preview = await filteredPhotoUri(uri, "warm", 200);
    expect(preview).toBe("file:///tmp/katkee-crop-1.jpg");
    const saved = g.__nitroImage.saved[0]!;
    expect(saved.steps).toEqual([["raw", "RGBA"]]);
    // 400×300 stored sideways (orientation 6): upright it is 300×400, then fitted in 200.
    expect([saved.width, saved.height]).toEqual([150, 200]);
    expect(Array.from(saved.pixels!.slice(0, 4))).toEqual([...expected("warm", [200, 120, 90]), 255]);
    // Cached: the same preview doesn't run twice, and Original is the photo itself.
    expect(await filteredPhotoUri(uri, "warm", 200)).toBe(preview);
    expect(await filteredPhotoUri(uri, "original", 200)).toBe(uri);
    expect(g.__nitroImage.saved).toHaveLength(1);
    forgetFilteredPhoto(uri);
  });

  it("lets iOS turn the photo itself (it applies EXIF when drawing)", async () => {
    Platform.OS = "ios";
    const uri = "file:///camera/IMG_3.jpg";
    await filteredPhotoUri(uri, "mono", 400);
    expect(RNFS.read).not.toHaveBeenCalledWith(expect.stringContaining("IMG_3"), expect.anything(), expect.anything(), expect.anything());
    expect([g.__nitroImage.saved[0]!.width, g.__nitroImage.saved[0]!.height]).toEqual([400, 300]);
    forgetFilteredPhoto(uri);
  });

  it("fails cleanly when the photo can't be read, so the editor can fall back", async () => {
    g.__nitroImage.fail = true;
    await expect(filteredPhotoUri("file:///missing.jpg", "cool", 200)).rejects.toThrow("unreadable");
    g.__nitroImage.fail = false;
    await expect(filteredPhotoUri("file:///missing.jpg", "cool", 200)).resolves.toMatch(/^file:\/\//);
  });
});

describe("FilterStrip", () => {
  let tree: ReactTestRenderer;
  const flush = async () => { for (let i = 0; i < 12; i++) await act(async () => { await Promise.resolve(); }); };
  const buttons = () => tree.root.findAll((n: ReactTestInstance) => typeof n.type === "string" && n.props.accessibilityRole === "button");
  const button = (label: string) => buttons().find((n) => n.props.accessibilityLabel === label)!;

  it("shows every filter on the photo, and marks the chosen one", async () => {
    const onSelect = jest.fn();
    await act(async () => { tree = create(<FilterStrip kind="photo" mediaUri="file:///camera/IMG_4.jpg" selected="Warm" onSelect={onSelect} />); });
    await flush();
    expect(buttons()).toHaveLength(FILTER_PREVIEWS.length);
    expect(button("Warm filter").props.accessibilityState).toMatchObject({ selected: true });
    expect(button("Mono filter").props.accessibilityState).toMatchObject({ selected: false });
    // Every tile but Original is the photo with its filter applied.
    expect(g.__nitroImage.saved).toHaveLength(FILTER_PREVIEWS.length - 1);
    const mono = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === "function" && n.props.accessibilityLabel === "Mono filter");
    await act(async () => mono.props.onPress());
    expect(onSelect).toHaveBeenCalledWith("Mono");
    forgetFilteredPhoto("file:///camera/IMG_4.jpg");
  });

  it("shows swatches for a video", async () => {
    await act(async () => { tree = create(<FilterStrip kind="video" mediaUri="file:///camera/VID_1.mp4" selected="Original" onSelect={jest.fn()} />); });
    await flush();
    expect(buttons()).toHaveLength(FILTER_PREVIEWS.length);
    expect(g.__nitroImage.saved).toHaveLength(0);
  });
});
