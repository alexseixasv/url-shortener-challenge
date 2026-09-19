-- CreateTable
CREATE TABLE "links" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMPTZ(3),
    "maxClicks" BIGINT,
    "clickCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_events" (
    "id" BIGSERIAL NOT NULL,
    "linkId" UUID NOT NULL,
    "accessedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referer" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "access_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_link_stats" (
    "linkId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "clickCount" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "daily_link_stats_pkey" PRIMARY KEY ("linkId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "links_slug_key" ON "links"("slug");

-- CreateIndex
CREATE INDEX "access_events_linkId_accessedAt_idx" ON "access_events"("linkId", "accessedAt" DESC);

-- AddForeignKey
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_link_stats" ADD CONSTRAINT "daily_link_stats_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "links"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
