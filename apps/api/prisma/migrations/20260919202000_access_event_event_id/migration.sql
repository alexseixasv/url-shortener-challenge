-- AlterTable
ALTER TABLE "access_events" ADD COLUMN "eventId" UUID;

-- Backfill existing rows (if any) before NOT NULL
UPDATE "access_events" SET "eventId" = gen_random_uuid() WHERE "eventId" IS NULL;

-- AlterTable
ALTER TABLE "access_events" ALTER COLUMN "eventId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "access_events_eventId_key" ON "access_events"("eventId");
