export type Updater<T> = (updater: (value: T) => void) => void;

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export interface RequestMessage {
  role: MessageRole;
  content: string;
}

export type DalleQuality = "standard" | "hd" | "low" | "medium" | "high" | "auto";
export type DalleStyle = "vivid" | "natural";

export type ModelSize =
  | "auto"
  | "1024x1024"
  | "1792x1024"
  | "1024x1792"
  | "768x1344"
  | "864x1152"
  | "1344x768"
  | "1152x864"
  | "1440x720"
  | "720x1440"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048";

// --- Unified media (image/video) parameter types ---

// UI-facing aspect ratio labels
export type MediaAspectRatio =
  | "auto"
  | "1:1"
  | "3:2"
  | "3:4"
  | "9:16"
  | "16:9"
  | "custom";

// UI-facing quality/resolution labels
export type MediaQualityLevel = "auto" | "1k" | "2k" | "3k" | "4k";

// Per-model size option with API mapping
export interface MediaSizeOption {
  label: MediaAspectRatio;
  apiValue: string; // the value sent to the API (e.g. "1024x1024", "auto")
  disabled?: boolean; // true if this model doesn't support this ratio
}

// Per-model quality option with API mapping
export interface MediaQualityOption {
  label: MediaQualityLevel;
  apiValue: string; // the value sent to the API (e.g. "low", "hd", "auto")
  disabled?: boolean;
}

// Per-model style option
export interface MediaStyleOption {
  label: string;
  apiValue: string;
}
