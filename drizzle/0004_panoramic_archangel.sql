UPDATE `users` SET `role` = 'admin' WHERE `role` = 'officer';--> statement-breakpoint
UPDATE `users` SET `role` = 'buyer' WHERE `role` = 'user' OR `role` IS NULL;--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('buyer','seller','admin','superadmin') NOT NULL DEFAULT 'buyer';--> statement-breakpoint
ALTER TABLE `conversations` ADD `sellerId` int;--> statement-breakpoint
ALTER TABLE `conversations` ADD `productId` int;--> statement-breakpoint
ALTER TABLE `products` ADD `verificationStatus` enum('draft','pending','approved','rejected') DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `visibility` enum('hidden','visible') DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `rejectionReason` text;--> statement-breakpoint
ALTER TABLE `products` ADD `primaryImageUrl` varchar(1000);--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_sellerId_users_id_fk` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `conversations` ADD CONSTRAINT `conversations_productId_products_id_fk` FOREIGN KEY (`productId`) REFERENCES `products`(`id`) ON DELETE no action ON UPDATE no action;