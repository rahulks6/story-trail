export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly fieldErrors?: Record<string, string>,
    /** Response headers to send with the error, e.g. Retry-After on a 429. */
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
