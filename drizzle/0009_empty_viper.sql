ALTER TABLE `transactions` MODIFY COLUMN `completedAt` timestamp;--> statement-breakpoint
UPDATE `transactions` AS t
INNER JOIN `orders` AS o ON o.`id` = t.`orderId`
SET t.`completedAt` = CASE
  WHEN o.`status` = 'completed' THEN COALESCE(o.`completedAt`, t.`completedAt`)
  ELSE NULL
END;