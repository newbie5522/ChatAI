"use client";

import { useEffect, useRef, useState } from "react";

import CloseIcon from "../icons/close.svg";
import LeftIcon from "../icons/left.svg";
import ResetIcon from "../icons/reload.svg";
import ZoomIcon from "../icons/zoom.svg";
import styles from "./image-preview.module.scss";

export interface PreviewImage {
  src: string;
  fullSrc?: string;
  alt: string;
}

export function ImagePreview(props: {
  images: PreviewImage[];
  className?: string;
  compact?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragStart = useRef<{ x: number; y: number } | undefined>(undefined);

  const close = () => {
    setActiveIndex(null);
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };
  const updateScale = (next: number) => {
    setScale(Math.min(4, Math.max(0.5, next)));
    if (next <= 1) setOffset({ x: 0, y: 0 });
  };
  const move = (direction: -1 | 1) => {
    if (activeIndex === null || props.images.length < 2) return;
    setActiveIndex(
      (activeIndex + direction + props.images.length) % props.images.length,
    );
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const active = activeIndex === null ? undefined : props.images[activeIndex];
  if (props.images.length === 0) return null;

  return (
    <>
      <div
        className={`${styles.grid} ${props.compact ? styles.compact : ""} ${
          props.className ?? ""
        }`}
      >
        {props.images.map((image, index) => (
          <button
            type="button"
            className={styles.thumbnail}
            key={`${image.src}-${index}`}
            onClick={() => setActiveIndex(index)}
            aria-label={`预览图片 ${index + 1}`}
          >
            <img src={image.src} alt={image.alt} />
          </button>
        ))}
      </div>
      {active && (
        <div className={styles.lightbox} role="dialog" aria-modal="true">
          <button
            type="button"
            className={styles.backdrop}
            onClick={close}
            aria-label="关闭图片预览"
          />
          <div className={styles.toolbar}>
            <button
              type="button"
              onClick={() => updateScale(scale - 0.25)}
              aria-label="缩小"
            >
              −
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => updateScale(scale + 0.25)}
              aria-label="放大"
            >
              <ZoomIcon />
            </button>
            <button
              type="button"
              onClick={() => updateScale(1)}
              aria-label="适应窗口"
            >
              <ResetIcon />
            </button>
            <button type="button" onClick={close} aria-label="关闭">
              <CloseIcon />
            </button>
          </div>
          {props.images.length > 1 && (
            <>
              <button
                type="button"
                className={styles.previous}
                onClick={() => move(-1)}
                aria-label="上一张"
              >
                <LeftIcon />
              </button>
              <button
                type="button"
                className={styles.next}
                onClick={() => move(1)}
                aria-label="下一张"
              >
                <LeftIcon />
              </button>
            </>
          )}
          <div
            className={styles.stage}
            onWheel={(event) => {
              event.preventDefault();
              updateScale(scale + (event.deltaY < 0 ? 0.2 : -0.2));
            }}
            onPointerDown={(event) => {
              if (scale > 1) {
                dragStart.current = {
                  x: event.clientX - offset.x,
                  y: event.clientY - offset.y,
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }
            }}
            onPointerMove={(event) => {
              if (!dragStart.current) return;
              setOffset({
                x: event.clientX - dragStart.current.x,
                y: event.clientY - dragStart.current.y,
              });
            }}
            onPointerUp={() => {
              dragStart.current = undefined;
            }}
          >
            <img
              src={active.fullSrc ?? active.src}
              alt={active.alt}
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                cursor: scale > 1 ? "grab" : "default",
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
