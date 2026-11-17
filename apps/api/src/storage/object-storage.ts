export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_MIMES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type AllowedDocumentMime = (typeof ALLOWED_DOCUMENT_MIMES)[number];

export type StoredObject = {
  key: string;
  sha256: string;
};

export interface StorageAdapter {
  put(bytes: Buffer, meta?: { mimeType?: string }): Promise<StoredObject>;
  read(key: string): Promise<Buffer>;
  remove?(key: string): Promise<void>;
}

export abstract class ObjectStorage implements StorageAdapter {
  abstract put(bytes: Buffer, meta?: { mimeType?: string }): Promise<StoredObject>;
  abstract read(key: string): Promise<Buffer>;
  abstract remove(key: string): Promise<void>;
}

export function detectDocumentMime(bytes: Buffer): AllowedDocumentMime | null {
  if (bytes.length < 4 || bytes.length > MAX_DOCUMENT_BYTES || isExecutable(bytes)) {
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
  if (
    bytes.length >= 8 &&
    b0 === 0x89 &&
    b1 === 0x50 &&
    b2 === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
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
