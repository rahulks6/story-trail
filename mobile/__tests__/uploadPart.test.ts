import { uploadPart } from "../src/api/media";

/** A stand-in for React Native's XMLHttpRequest that records what would be sent. */
class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  method = "";
  url = "";
  status = 0;
  timeout = 0;
  upload = { onprogress: null as null | ((e: { loaded: number }) => void) };
  onload: null | (() => void) = null;
  onerror: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  body: unknown;
  constructor() { FakeXhr.last = this; }
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.body = body; this.status = 200; this.onload?.(); }
}

it("sends each part with a Content-Type, which Android requires for any request body", async () => {
  const g = globalThis as unknown as { XMLHttpRequest: unknown };
  const original = g.XMLHttpRequest;
  g.XMLHttpRequest = FakeXhr;
  try {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    await uploadPart("https://storage.example/part?X-Amz-Signature=abc", bytes);
    expect(FakeXhr.last.method).toBe("PUT");
    expect(FakeXhr.last.headers["Content-Type"]).toBe("application/octet-stream");
    expect(FakeXhr.last.body).toBe(bytes);
  } finally {
    g.XMLHttpRequest = original;
  }
});
