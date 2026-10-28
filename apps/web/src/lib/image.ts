/** The server works at this size; sending more only costs the checker's mobile data. */
const MAX_SIDE = 2048;

/**
 * Downscales a photo before upload and re-encodes it as JPEG, which also drops
 * EXIF metadata such as GPS position. Falls back to the original file if the
 * browser can't decode it (the server will report a bad image).
 */
export async function prepareUpload(file: Blob, maxSide = MAX_SIDE): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.9),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}
