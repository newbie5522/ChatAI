import { clear, createStore, del, get, set, values } from "idb-keyval";

export interface StoredMessageMedia {
  mediaId: string;
  accountId: string;
  mimeType: string;
  name: string;
  originalBlob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  size: number;
  createdAt: number;
  lastAccessAt: number;
}

type MediaStore = ReturnType<typeof createStore>;

let mediaStore: MediaStore | undefined;
const MAX_MEDIA_COUNT = 200;
const MAX_MEDIA_BYTES = 250 * 1024 * 1024;
const THUMBNAIL_EDGE = 320;

function browserMediaStorageAvailable() {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function getMediaStore(): MediaStore | undefined {
  if (!browserMediaStorageAvailable()) return undefined;
  mediaStore ??= createStore("newbiechat-browser-data", "message-media");
  return mediaStore;
}

function mediaKey(accountId: string, mediaId: string) {
  return `${accountId}:${mediaId}`;
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
) {
  return new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mimeType, quality),
  );
}

async function createThumbnail(file: File) {
  if (typeof document === "undefined") {
    return { width: 0, height: 0, thumbnailBlob: file };
  }

  let source: CanvasImageSource | undefined;
  let width = 0;
  let height = 0;
  let release: () => void = () => undefined;

  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
      release = () => bitmap.close();
    } catch {
      source = undefined;
    }
  }

  if (
    !source &&
    typeof Image === "function" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  ) {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("无法读取图片缩略图"));
        image.src = objectUrl;
      });
    } catch {
      URL.revokeObjectURL(objectUrl);
      return { width: 0, height: 0, thumbnailBlob: file };
    }
    source = image;
    width = image.naturalWidth;
    height = image.naturalHeight;
    release = () => URL.revokeObjectURL(objectUrl);
  }

  if (!source) {
    return { width: 0, height: 0, thumbnailBlob: file };
  }

  try {
    const ratio = Math.min(
      1,
      THUMBNAIL_EDGE / Math.max(width, height),
    );
    const thumbnailWidth = Math.max(1, Math.round(width * ratio));
    const thumbnailHeight = Math.max(1, Math.round(height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = thumbnailWidth;
    canvas.height = thumbnailHeight;
    const context = canvas.getContext("2d");
    if (!context) return { width, height, thumbnailBlob: file };
    context.drawImage(source, 0, 0, thumbnailWidth, thumbnailHeight);
    const thumbnailBlob =
      (await canvasBlob(canvas, "image/webp", 0.78)) ??
      (await canvasBlob(canvas, "image/jpeg", 0.78)) ??
      file;
    return { width, height, thumbnailBlob };
  } finally {
    release();
  }
}

export async function cleanupMessageMedia(
  accountId: string,
  protectedMediaIds: ReadonlySet<string> = new Set<string>(),
) {
  const store = getMediaStore();
  if (!store) return;
  const records = (await values(store)) as StoredMessageMedia[];
  const accountRecords = records
    .filter((record) => record.accountId === accountId)
    .sort((left, right) => left.lastAccessAt - right.lastAccessAt);
  let count = accountRecords.length;
  let bytes = accountRecords.reduce(
    (total, record) =>
      total + record.originalBlob.size + record.thumbnailBlob.size,
    0,
  );
  const removed = new Set<string>();
  const removeRecord = async (record: StoredMessageMedia) => {
    await del(mediaKey(accountId, record.mediaId), store);
    removed.add(record.mediaId);
    count -= 1;
    bytes -= record.originalBlob.size + record.thumbnailBlob.size;
  };
  for (const record of accountRecords) {
    if (count <= MAX_MEDIA_COUNT && bytes <= MAX_MEDIA_BYTES) break;
    if (protectedMediaIds.has(record.mediaId)) continue;
    await removeRecord(record);
  }
  for (const record of accountRecords) {
    if (count <= MAX_MEDIA_COUNT && bytes <= MAX_MEDIA_BYTES) break;
    if (removed.has(record.mediaId)) continue;
    await removeRecord(record);
  }
}

export async function saveMessageMedia(
  file: File,
  accountId: string,
  protectedMediaIds: ReadonlySet<string> = new Set<string>(),
) {
  const store = getMediaStore();
  if (!store) throw new Error("消息图片存储只能在浏览器中使用。");
  const { width, height, thumbnailBlob } = await createThumbnail(file);
  const now = Date.now();
  const record: StoredMessageMedia = {
    mediaId: crypto.randomUUID(),
    accountId,
    mimeType: file.type,
    name: file.name,
    originalBlob: file,
    thumbnailBlob,
    width,
    height,
    size: file.size,
    createdAt: now,
    lastAccessAt: now,
  };
  await set(mediaKey(accountId, record.mediaId), record, store);
  await cleanupMessageMedia(
    accountId,
    new Set([...protectedMediaIds, record.mediaId]),
  );
  return record;
}

export async function getMessageMedia(accountId: string, mediaId: string) {
  const store = getMediaStore();
  if (!store) return undefined;
  const key = mediaKey(accountId, mediaId);
  const record = await get<StoredMessageMedia>(key, store);
  if (!record || record.accountId !== accountId) return undefined;
  const updated = { ...record, lastAccessAt: Date.now() };
  await set(key, updated, store);
  return updated;
}

export async function deleteMessageMedia(accountId: string, mediaId: string) {
  const store = getMediaStore();
  if (!store) return;
  await del(mediaKey(accountId, mediaId), store);
}

export async function deleteUnreferencedMessageMedia(
  accountId: string,
  candidates: string[],
  referencedMediaIds: ReadonlySet<string>,
) {
  const store = getMediaStore();
  if (!store) return;
  await Promise.all(
    candidates
      .filter((mediaId) => !referencedMediaIds.has(mediaId))
      .map((mediaId) => del(mediaKey(accountId, mediaId), store)),
  );
}

export async function clearMessageMedia(accountId?: string) {
  const store = getMediaStore();
  if (!store) return;
  if (!accountId) {
    await clear(store);
    return;
  }
  const records = (await values(store)) as StoredMessageMedia[];
  await Promise.all(
    records
      .filter((record) => record.accountId === accountId)
      .map((record) => del(mediaKey(accountId, record.mediaId), store)),
  );
}
