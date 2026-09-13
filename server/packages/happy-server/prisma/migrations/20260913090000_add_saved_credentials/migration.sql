-- CreateTable
CREATE TABLE "SavedCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "usages" JSONB NOT NULL,
    "encryptedPayload" BYTEA NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SavedCredential_accountId_name_key" ON "SavedCredential"("accountId", "name");

-- CreateIndex
CREATE INDEX "SavedCredential_accountId_updatedAt_idx" ON "SavedCredential"("accountId", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "SavedCredential" ADD CONSTRAINT "SavedCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
