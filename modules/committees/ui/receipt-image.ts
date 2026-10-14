/**
 * Prepares a receipt picture on the phone before it is uploaded: re-encoded as a
 * JPEG at most 2,000 pixels on its long side. A phone photo of 3–8 MB becomes a few
 * hundred kilobytes — quick on mobile data and still legible — and re-encoding drops
 * the photo's embedded metadata, including where it was taken. Browser-only.
 */

const MAX_DIMENSION = 2000;
const QUALITY = 0.85;

export type PreparedReceipt = { blob: Blob; fileName: string };

function baseName(name: string): string {
  const withoutExtension = name.replace(/\.[^.]*$/, "").trim();
  return withoutExtension === "" ? "receipt" : withoutExtension.slice(0, 120);
}

export async function prepareReceiptImage(file: File): Promise<PreparedReceipt> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("No 2D canvas");
    // A transparent PNG would turn black as a JPEG; paper is white.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    if (blob === null) throw new Error("The picture could not be encoded");
    return { blob, fileName: `${baseName(file.name)}.jpg` };
  } catch {
    // Re-encoding is an optimisation: the original picture is still a valid upload,
    // and the server checks its content either way.
    return { blob: file, fileName: file.name };
  }
}
