const UPLOAD_IMAGE_TYPE = /^image\/(jpeg|jpg|png|webp)$/i;

/** Downscale very large photos before harvest-sheet upload / OCR. */
export async function shrinkHarvestSheetImageFileIfLarge(file: File, maxEdge = 2000): Promise<File> {
  const type = (file.type || "").toLowerCase();
  if (!UPLOAD_IMAGE_TYPE.test(type) || !file.size) return file;

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode"));
      img.src = url;
    });
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (!nw || !nh) return file;
    const scale = Math.min(1, maxEdge / Math.max(nw, nh));
    if (scale >= 1) return file;
    const tw = Math.round(nw * scale);
    const th = Math.round(nh * scale);
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, tw, th);
    const blob = await new Promise<Blob | null>((r) =>
      canvas.toBlob((b) => r(b), "image/jpeg", 0.88),
    );
    if (!blob) return file;
    const base = file.name.replace(/\.[^.\\/]+$/, "") || "harvest-sheet";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function fileToBase64DataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Could not read image file"));
    r.readAsDataURL(file);
  });
}
