ALTER TABLE `products` ADD `variety` varchar(180) NULL;--> statement-breakpoint
UPDATE `products` SET `variety` = 'Unspecified' WHERE `variety` IS NULL;--> statement-breakpoint
ALTER TABLE `products` MODIFY COLUMN `variety` varchar(180) NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `minOrderQty` int DEFAULT 1 NOT NULL;