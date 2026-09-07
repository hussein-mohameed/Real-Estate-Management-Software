-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancellationRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancellationRequestedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Subscription_cancellationRequestedAt_idx" ON "Subscription"("cancellationRequestedAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_cancellationRequestedByUserId_fkey" FOREIGN KEY ("cancellationRequestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
