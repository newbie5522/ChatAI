export type Updater<T> = (updater: (value: T) => void) => void;

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export interface RequestMessage {
  role: MessageRole;
  content: string;
}

export type DalleSize = "1024x1024" | "1792x1024" | "1024x1792";
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
