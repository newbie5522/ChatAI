import type { ModelCategory } from "../config/model-registry";

export type ImageAttachmentRouteMode =
  | "native_understanding"
  | "native_image_edit"
  | "native_image_to_video"
  | "bridge_to_text"
  | "bridge_to_image_prompt"
  | "bridge_to_video_prompt";

export interface ImageInputModelDescriptor {
  category?: ModelCategory;
  capabilities?: {
    vision?: boolean;
    imageEditing?: boolean;
    referenceImages?: boolean;
    imageToVideo?: boolean;
  };
}
