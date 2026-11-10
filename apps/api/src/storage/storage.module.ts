import { Module } from "@nestjs/common";
import { LocalObjectStorage } from "./local-object-storage.js";
import { ObjectStorage } from "./object-storage.js";

@Module({
  providers: [LocalObjectStorage, { provide: ObjectStorage, useExisting: LocalObjectStorage }],
  exports: [ObjectStorage],
})
export class StorageModule {}
