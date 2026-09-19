ALTER TABLE `transactions` MODIFY COLUMN `status` enum('recorded','payment_coordinated','pending','paid','failed') NOT NULL DEFAULT 'recorded';--> statement-breakpoint
ALTER TABLE `orders` ADD `paymentStatus` enum('pending','paid','failed','F2F-pending-confirmation') DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `paymentMethod` varchar(64);--> statement-breakpoint
ALTER TABLE `transactions` ADD `paymentMethod` varchar(64);--> statement-breakpoint
ALTER TABLE `transactions` ADD `externalId` varchar(128);