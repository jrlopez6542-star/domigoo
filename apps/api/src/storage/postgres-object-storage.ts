import { createHash, randomUUID } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Database } from "../database.js";
import {
  detectDocumentMime,
  MAX_DOCUMENT_BYTES,
  ObjectStorage,
  type StoredObject,
} from "./object-storage.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PostgresObjectStorage extends ObjectStorage {
  constructor(private readonly database: Database) {
    super();
  }

  async put(bytes: Buffer, meta?: { mimeType?: string }): Promise<StoredObject> {
    if (bytes.length === 0 || bytes.length > MAX_DOCUMENT_BYTES) {
      throw new Error("El archivo supera el tamaño máximo permitido");
    }
    const detected = detectDocumentMime(bytes);
    if (detected === null) {
      throw new Error("Tipo de archivo no permitido");
    }
    const mimeType = meta?.mimeType ?? detected;
    const key = randomUUID();
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await this.database.pool.query(
      `INSERT INTO stored_objects (key, "mimeType", "byteSize", sha256, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [key, mimeType, bytes.length, sha256, bytes],
    );
    return { key, sha256 };
  }

  async read(key: string): Promise<Buffer> {
    if (!UUID_RE.test(key)) {
      throw new NotFoundException();
    }
    const result = await this.database.pool.query<{ data: Buffer }>(
      `SELECT data FROM stored_objects WHERE key = $1`,
      [key],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new NotFoundException();
    }
    return Buffer.from(row.data);
  }

  async remove(key: string): Promise<void> {
    if (!UUID_RE.test(key)) {
      return;
    }
    await this.database.pool.query(`DELETE FROM stored_objects WHERE key = $1`, [key]);
  }
}
