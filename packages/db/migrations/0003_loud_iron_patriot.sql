DROP INDEX "listings_item_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "listings_item_uq" ON "listings" USING btree ("inventory_item_id") WHERE "listings"."status" = 'active';