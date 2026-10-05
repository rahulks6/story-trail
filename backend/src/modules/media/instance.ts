import { config } from "../../config/env";
import { LocalObjectStore, type ObjectStore } from "./storage";
import { S3ObjectStore } from "./s3-store";

function createStore(): ObjectStore {
  if (config.media.store === "s3") {
    return new S3ObjectStore({
      bucket: config.media.s3.bucket,
      region: config.media.s3.region,
      endpoint: config.media.s3.endpoint || undefined,
      forcePathStyle: config.media.s3.forcePathStyle,
    });
  }
  return new LocalObjectStore(config.media.storageRoot);
}

/** The process-wide media store selected by MEDIA_STORE. */
export const mediaStorage: ObjectStore = createStore();
