import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { APP_ENV, type AppEnv } from "../config/env.js";
import { ObjectStorage, type StoredObject } from "./object-storage.js";

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class LocalObjectStorage extends ObjectStorage {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    super();
  }

  async put(bytes: Buffer): Promise<StoredObject> {
    const key = randomUUID();
    const file = this.safePath(key);
    await mkdir(this.env.storageDir, { recursive: true, mode: 0o700 });
    await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    return { key, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.safePath(key));
  }

  private safePath(key: string): string {
    if (!KEY.test(key)) {
      throw new Error("La clave de almacenamiento no es válida");
    }
    const root = resolve(this.env.storageDir);
    const file = resolve(root, key);
    if (!file.startsWith(`${root}${sep}`)) {
      throw new Error("La clave de almacenamiento no es válida");
    }
    return file;
  }
}
