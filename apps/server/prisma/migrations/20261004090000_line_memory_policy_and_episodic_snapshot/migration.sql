ALTER TABLE "LineOaAccount" ADD COLUMN "memoryPolicy" TEXT NOT NULL DEFAULT 'OFF';

ALTER TABLE "LineConversationJob" ADD COLUMN "episodicMemoryOptIn" BOOLEAN NOT NULL DEFAULT false;
