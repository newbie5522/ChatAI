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

const mediaStore = createStore("newbiechat-browser-data", "message-media");
const MAX_MEDIA_COUNT = 200;
const MAX_MEDIA_BYTES = 250 * 1024 * 1024;
const THUMBNAIL_EDGE = 320;

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
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(
      1,
      THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法创建图片缩略图");
    context.drawImage(bitmap, 0, 0, width, height);
    const thumbnailBlob =
      (await canvasBlob(canvas, "image/webp", 0.78)) ??
      (await canvasBlob(canvas, "image/jpeg", 0.78)) ??
      file;
    return {
      width: bitmap.width,
      height: bitmap.height,
      thumbnailBlob,
    };
  } finally {
    bitmap.close();
  }
}

export async function cleanupMessageMedia(
  accountId: string,
  protectedMediaIds: ReadonlySet<string> = new Set<string>(),
) {
  const records = (await values(mediaStore)) as StoredMessageMedia[];
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
    await del(mediaKey(accountId, record.mediaId), mediaStore);
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
  await set(mediaKey(accountId, record.mediaId), record, mediaStore);
  await cleanupMessageMedia(
    accountId,
    new Set([...protectedMediaIds, record.mediaId]),
  );
  return record;
}

export async function getMessageMedia(accountId: string, mediaId: string) {
  const key = mediaKey(accountId, mediaId);
  const record = await get<StoredMessageMedia>(key, mediaStore);
  if (!record || record.accountId !== accountId) return undefined;
  const updated = { ...record, lastAccessAt: Date.now() };
  await set(key, updated, mediaStore);
  return updated;
}

export async function deleteMessageMedia(accountId: string, mediaId: string) {
  await del(mediaKey(accountId, mediaId), mediaStore);
}

export async function deleteUnreferencedMessageMedia(
  accountId: string,
  candidates: string[],
  referencedMediaIds: ReadonlySet<string>,
) {
  await Promise.all(
    candidates
      .filter((mediaId) => !referencedMediaIds.has(mediaId))
      .map((mediaId) => deleteMessageMedia(accountId, mediaId)),
  );
}

export async function clearMessageMedia(accountId?: string) {
  if (!accountId) {
    await clear(mediaStore);
    return;
  }
  const records = (await values(mediaStore)) as StoredMessageMedia[];
  await Promise.all(
    records
      .filter((record) => record.accountId === accountId)
      .map((record) => deleteMessageMedia(accountId, record.mediaId)),
  );
}
