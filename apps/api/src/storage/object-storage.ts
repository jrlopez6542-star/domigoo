export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export type StoredObject = {
  key: string;
  sha256: string;
};

export abstract class ObjectStorage {
  abstract put(bytes: Buffer): Promise<StoredObject>;
  abstract read(key: string): Promise<Buffer>;
}

export function detectDocumentMime(bytes: Buffer): "application/pdf" | "image/jpeg" | null {
  if (bytes.length < 4 || isExecutable(bytes)) {
    return null;
  }
  if (bytes.subarray(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return "image/jpeg";
  }
  return null;
}

function isExecutable(bytes: Buffer): boolean {
  const b0 = bytes[0];
  const b1 = bytes[1];
  const b2 = bytes[2];
  const b3 = bytes[3];
  const dos = b0 === 0x4d && b1 === 0x5a;
  const elf = b0 === 0x7f && b1 === 0x45 && b2 === 0x4c && b3 === 0x46;
  return dos || elf;
}
