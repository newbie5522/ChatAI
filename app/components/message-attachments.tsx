"use client";

import { useEffect, useState } from "react";

import type { StoredAttachmentMetadata } from "../types/attachment";
import UploadIcon from "../icons/upload.svg";
import { useAccountStore } from "../store/account";
import { getMessageMedia } from "../utils/message-media-store";
import { formatAttachmentSize } from "../utils/attachments";
import { ImagePreview, PreviewImage } from "./image-preview";
import styles from "./image-preview.module.scss";

interface LoadedMedia {
  preview: PreviewImage;
  mediaId: string;
}

export function MessageAttachments(props: {
  attachments?: StoredAttachmentMetadata[];
}) {
  const accountId = useAccountStore((state) => state.user?.userId);
  const [loaded, setLoaded] = useState<LoadedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const imageAttachments = (props.attachments ?? []).filter(
    (attachment) => attachment.kind === "image",
  );
  const files = (props.attachments ?? []).filter(
    (attachment) => attachment.kind !== "image",
  );

  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    setLoaded([]);
    if (!accountId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void Promise.all(
      imageAttachments.map(async (attachment) => {
        if (!attachment.mediaId) return undefined;
        try {
          const media = await getMessageMedia(accountId, attachment.mediaId);
          if (!media) return undefined;
          const src = URL.createObjectURL(media.thumbnailBlob);
          const fullSrc = URL.createObjectURL(media.originalBlob);
          urls.push(src, fullSrc);
          return {
            mediaId: media.mediaId,
            preview: { src, fullSrc, alt: attachment.name },
          };
        } catch {
          return undefined;
        }
      }),
    ).then((items) => {
      if (!disposed) {
        setLoaded(
          items.filter(
            (item): item is NonNullable<typeof item> => item !== undefined,
          ),
        );
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [accountId, props.attachments]);

  if ((props.attachments?.length ?? 0) === 0) return null;
  const unavailable = loading
    ? []
    : imageAttachments.filter(
        (attachment) =>
          !loaded.some((item) => item.mediaId === attachment.mediaId),
      );
  return (
    <div className={styles.attachmentList}>
      <ImagePreview images={loaded.map((item) => item.preview)} />
      {[...files, ...unavailable].map((attachment) => (
        <div className={styles.fileCard} key={attachment.id}>
          <div className={styles.fileIcon}>
            <UploadIcon />
          </div>
          <strong>{attachment.name}</strong>
          <span>{formatAttachmentSize(attachment.size)}</span>
          {attachment.kind === "image" && <span>本地预览已清理</span>}
        </div>
      ))}
    </div>
  );
}
