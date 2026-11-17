-- M47: Almacenamiento privado en PostgreSQL y rate limiting persistente

CREATE TABLE "stored_objects" (
  "key" UUID NOT NULL,
  "mimeType" VARCHAR(80) NOT NULL,
  "byteSize" INTEGER NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "data" BYTEA NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "rate_limit_buckets" (
  "key" VARCHAR(180) NOT NULL,
  "count" INTEGER NOT NULL,
  "windowStart" TIMESTAMPTZ(6) NOT NULL,
  "blockedUntil" TIMESTAMPTZ(6),

  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_buckets_windowStart_idx" ON "rate_limit_buckets"("windowStart");
CREATE INDEX "rate_limit_buckets_blockedUntil_idx" ON "rate_limit_buckets"("blockedUntil");
