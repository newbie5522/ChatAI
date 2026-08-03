import type { ImageInputModelDescriptor } from "../types/image-input";
import type { ImageAttachmentRouteMode } from "../types/image-input";

export function getImageAttachmentRouteMode(
  model: ImageInputModelDescriptor,
): ImageAttachmentRouteMode {
  if (model.category === "image") {
    return model.capabilities?.imageEditing ||
      model.capabilities?.referenceImages
      ? "native_image_edit"
      : "bridge_to_image_prompt";
  }
  if (model.category === "video") {
    return model.capabilities?.imageToVideo
      ? "native_image_to_video"
      : "bridge_to_video_prompt";
  }
  return model.capabilities?.vision ? "native_understanding" : "bridge_to_text";
}
