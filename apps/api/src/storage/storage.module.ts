import { Module } from "@nestjs/common";
import { LocalObjectStorage } from "./local-object-storage.js";
import { ObjectStorage } from "./object-storage.js";
import { PostgresObjectStorage } from "./postgres-object-storage.js";

@Module({
  providers: [
    LocalObjectStorage,
    PostgresObjectStorage,
    {
      provide: ObjectStorage,
      inject: [PostgresObjectStorage, LocalObjectStorage],
      useFactory: (pg: PostgresObjectStorage, local: LocalObjectStorage): ObjectStorage => {
        return process.env["STORAGE_DRIVER"] === "local" ? local : pg;
      },
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
