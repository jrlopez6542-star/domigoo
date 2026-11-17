import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFoundException } from "@nestjs/common";
import { defaultPinEnv, type AppEnv } from "../config/env.js";
import type { Database } from "../database.js";
import { LocalObjectStorage } from "./local-object-storage.js";
import { detectDocumentMime, MAX_DOCUMENT_BYTES, type StorageAdapter } from "./object-storage.js";
import { PostgresObjectStorage } from "./postgres-object-storage.js";

const PDF_SAMPLE = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "ascii");
const JPEG_SAMPLE = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_SAMPLE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const ELF_SAMPLE = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
const MZ_SAMPLE = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);

describe("detectDocumentMime", () => {
  it("acepta PDF, JPEG y PNG válidos", () => {
    expect(detectDocumentMime(PDF_SAMPLE)).toBe("application/pdf");
    expect(detectDocumentMime(JPEG_SAMPLE)).toBe("image/jpeg");
    expect(detectDocumentMime(PNG_SAMPLE)).toBe("image/png");
  });

  it("rechaza ejecutables, formatos desconocidos y archivos mayores a 10 MB", () => {
    expect(detectDocumentMime(ELF_SAMPLE)).toBeNull();
    expect(detectDocumentMime(MZ_SAMPLE)).toBeNull();
    expect(detectDocumentMime(Buffer.from("plain text"))).toBeNull();
    expect(detectDocumentMime(Buffer.alloc(3))).toBeNull();

    const oversized = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
    PDF_SAMPLE.copy(oversized, 0);
    expect(detectDocumentMime(oversized)).toBeNull();
  });
});

describe("LocalObjectStorage", () => {
  let storageDir = "";

  beforeEach(async () => {
    storageDir = await mkdtemp(join(tmpdir(), "domigoo-storage-test-"));
  });

  afterEach(async () => {
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it("guarda, lee y elimina objetos respetando StorageAdapter", async () => {
    const env: AppEnv = {
      databaseUrl: "postgresql://domigoo:domigoo@127.0.0.1:5432/domigoo",
      appName: "DOMIGOO",
      port: 3000,
      cookieSecure: false,
      storageDir,
      billingEnabled: false,
      subscriptionTrialDays: 15,
      subscriptionPlaceholderPriceCop: 0,
      ...defaultPinEnv(),
    };
    const storage: StorageAdapter = new LocalObjectStorage(env);
    const stored = await storage.put(PDF_SAMPLE, { mimeType: "application/pdf" });
    expect(stored.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(stored.sha256).toHaveLength(64);

    const loaded = await storage.read(stored.key);
    expect(loaded.equals(PDF_SAMPLE)).toBe(true);

    await storage.remove?.(stored.key);
    await expect(storage.read(stored.key)).rejects.toThrow();
  });
});

describe("PostgresObjectStorage", () => {
  it("almacena, lee y elimina en stored_objects con validación de clave, MIME y tamaño", async () => {
    const store = new Map<
      string,
      { mimeType: string; byteSize: number; sha256: string; data: Buffer }
    >();
    const fakeDatabase = {
      pool: {
        query: (sql: string, params: unknown[] = []) => {
          if (sql.includes("INSERT INTO stored_objects")) {
            const [key, mimeType, byteSize, sha256, data] = params as [
              string,
              string,
              number,
              string,
              Buffer,
            ];
            store.set(key, { mimeType, byteSize, sha256, data });
            return Promise.resolve({ rows: [], rowCount: 1 });
          }
          if (sql.includes("SELECT data FROM stored_objects")) {
            const [key] = params as [string];
            const found = store.get(key);
            return Promise.resolve({
              rows: found ? [{ data: found.data }] : [],
              rowCount: found ? 1 : 0,
            });
          }
          if (sql.includes("DELETE FROM stored_objects")) {
            const [key] = params as [string];
            const existed = store.delete(key);
            return Promise.resolve({ rows: [], rowCount: existed ? 1 : 0 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        },
      },
    } as unknown as Database;

    const storage = new PostgresObjectStorage(fakeDatabase);
    const stored = await storage.put(PNG_SAMPLE, { mimeType: "image/png" });
    expect(store.get(stored.key)?.mimeType).toBe("image/png");
    expect((await storage.read(stored.key)).equals(PNG_SAMPLE)).toBe(true);

    await expect(storage.put(ELF_SAMPLE)).rejects.toThrow("Tipo de archivo no permitido");
    await expect(storage.put(Buffer.alloc(0))).rejects.toThrow(
      "El archivo supera el tamaño máximo permitido",
    );
    await expect(storage.read("not-a-uuid")).rejects.toThrow(NotFoundException);

    await storage.remove(stored.key);
    await expect(storage.read(stored.key)).rejects.toThrow(NotFoundException);
  });
});
