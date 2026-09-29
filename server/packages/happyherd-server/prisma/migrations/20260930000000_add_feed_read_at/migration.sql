-- Keep existing and newly arriving updates unread until explicitly read.
ALTER TABLE "UserFeedItem" ADD COLUMN "readAt" TIMESTAMP(3);
