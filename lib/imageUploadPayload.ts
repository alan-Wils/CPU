/** JPEG / PNG / WebP payloads for `checkUpload`-style API bodies (`mimeType` + raw base64, no data URL prefix). */

export type ImageUploadMime = "image/jpeg" | "image/png" | "image/webp";

export function normalizeImageUploadMime(raw: string): ImageUploadMime | null {
  const m = String(raw || "").toLowerCase();
  if (m === "image/jpg" || m === "image/jpeg") return "image/jpeg";
  if (m === "image/png") return "image/png";
  if (m === "image/webp") return "image/webp";
  return null;
}

export async function fileToImageUploadPayload(file: File): Promise<{ mimeType: ImageUploadMime; dataBase64: string }> {
  const mimeType = normalizeImageUploadMime(file.type);
  if (!mimeType) {
    throw new Error("Use a JPEG, PNG, or WebP image.");
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the image file."));
    reader.readAsDataURL(file);
  });
  const stripped = dataUrl.replace(/^data:[^;]+;base64,/, "");
  if (!stripped || stripped.length < 20) {
    throw new Error("Invalid image data.");
  }
  return { mimeType, dataBase64: stripped };
}
