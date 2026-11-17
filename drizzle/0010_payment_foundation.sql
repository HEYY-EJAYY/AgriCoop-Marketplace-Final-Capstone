-- LEGACY MYSQL DIALECT ONLY. Do not execute against Supabase/PostgreSQL.
-- PostgreSQL migration output is isolated by drizzle.config.ts under
-- drizzle/postgres-migrations; convert/review this logic before porting it.

CREATE TABLE IF NOT EXISTS `payments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` int NOT NULL,
  `buyerId` int NOT NULL,
  `sellerId` int NOT NULL,
  `cooperativeId` int,
  `amountCents` int NOT NULL,
  `currency` varchar(8) NOT NULL DEFAULT 'PHP',
  `paymentMethod` varchar(64) NOT NULL DEFAULT 'f2f',
  `status` enum('pending','awaiting_verification','verified','failed','cancelled','refunded','expired') NOT NULL DEFAULT 'pending',
  `verifiedByUserId` int,
  `paymentReference` text,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP,
  `paidAt` timestamp,
  `verifiedAt` timestamp,
  CONSTRAINT `payments_id` PRIMARY KEY(`id`),
  CONSTRAINT `payments_order_id_idx` UNIQUE(`orderId`),
  CONSTRAINT `payments_orderId_orders_id_fk` FOREIGN KEY (`orderId`) REFERENCES `orders`(`id`),
  CONSTRAINT `payments_buyerId_users_id_fk` FOREIGN KEY (`buyerId`) REFERENCES `users`(`id`),
  CONSTRAINT `payments_sellerId_users_id_fk` FOREIGN KEY (`sellerId`) REFERENCES `users`(`id`),
  CONSTRAINT `payments_cooperativeId_cooperatives_id_fk` FOREIGN KEY (`cooperativeId`) REFERENCES `cooperatives`(`id`),
  CONSTRAINT `payments_verifiedByUserId_users_id_fk` FOREIGN KEY (`verifiedByUserId`) REFERENCES `users`(`id`)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `paymentEvents` (
  `id` int AUTO_INCREMENT NOT NULL,
  `paymentId` int NOT NULL,
  `actorUserId` int,
  `eventType` varchar(80) NOT NULL,
  `fromStatus` varchar(32),
  `toStatus` varchar(32),
  `reason` text,
  `metadata` text,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  CONSTRAINT `paymentEvents_id` PRIMARY KEY(`id`),
  CONSTRAINT `paymentEvents_paymentId_payments_id_fk` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`),
  CONSTRAINT `paymentEvents_actorUserId_users_id_fk` FOREIGN KEY (`actorUserId`) REFERENCES `users`(`id`),
  KEY `payment_events_payment_id_created_at_idx` (`paymentId`,`createdAt`)
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `paymentAttempts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `paymentId` int NOT NULL,
  `attemptNumber` int NOT NULL DEFAULT 1,
  `paymentMethod` varchar(64) NOT NULL DEFAULT 'f2f',
  `referenceNumber` varchar(160),
  `externalId` varchar(128),
  `evidenceUrl` varchar(1000),
  `status` enum('pending','submitted','under_review','approved','rejected','failed','expired','cancelled') NOT NULL DEFAULT 'pending',
  `submittedAt` timestamp DEFAULT (now()) NOT NULL,
  `reviewedByUserId` int,
  `rejectionReason` text,
  `metadata` text,
  `createdAt` timestamp DEFAULT (now()) NOT NULL,
  `updatedAt` timestamp DEFAULT (now()) NOT NULL ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `paymentAttempts_id` PRIMARY KEY(`id`),
  CONSTRAINT `paymentAttempts_payment_id_attempt_number_idx` UNIQUE(`paymentId`,`attemptNumber`),
  CONSTRAINT `paymentAttempts_paymentId_payments_id_fk` FOREIGN KEY (`paymentId`) REFERENCES `payments`(`id`),
  CONSTRAINT `paymentAttempts_reviewedByUserId_users_id_fk` FOREIGN KEY (`reviewedByUserId`) REFERENCES `users`(`id`)
);--> statement-breakpoint

INSERT INTO `payments` (
  `orderId`,
  `buyerId`,
  `sellerId`,
  `cooperativeId`,
  `amountCents`,
  `currency`,
  `paymentMethod`,
  `status`,
  `verifiedByUserId`,
  `paymentReference`,
  `createdAt`,
  `updatedAt`,
  `paidAt`,
  `verifiedAt`
)
SELECT
  o.`id`,
  o.`buyerId`,
  o.`sellerId`,
  o.`cooperativeId`,
  o.`totalCents`,
  'PHP',
  COALESCE(o.`paymentMethod`, t.`paymentMethod`, 'f2f'),
  CASE
    WHEN o.`paymentStatus` = 'failed' OR t.`status` = 'failed' THEN 'failed'
    ELSE 'pending'
  END,
  NULL,
  NULL,
  o.`createdAt`,
  o.`updatedAt`,
  NULL,
  NULL
FROM `orders` AS o
LEFT JOIN `transactions` AS t ON t.`orderId` = o.`id`
WHERE NOT EXISTS (
  SELECT 1
  FROM `payments` AS p
  WHERE p.`orderId` = o.`id`
);--> statement-breakpoint

INSERT INTO `paymentEvents` (
  `paymentId`,
  `actorUserId`,
  `eventType`,
  `fromStatus`,
  `toStatus`,
  `reason`,
  `metadata`,
  `createdAt`
)
SELECT
  p.`id`,
  NULL,
  'order_created',
  NULL,
  p.`status`,
  'Legacy backfill; payment remains unverified pending review',
  CONCAT(
    'legacyOrderStatus=', COALESCE(o.`status`, ''),
    '; legacyPaymentStatus=', COALESCE(o.`paymentStatus`, ''),
    '; legacyTransactionId=', COALESCE(t.`id`, ''),
    '; legacyTransactionStatus=', COALESCE(t.`status`, ''),
    '; legacyTransactionAmountCents=', COALESCE(t.`amountCents`, '')
  ),
  o.`createdAt`
FROM `payments` AS p
INNER JOIN `orders` AS o ON o.`id` = p.`orderId`
LEFT JOIN `transactions` AS t ON t.`orderId` = o.`id`
WHERE NOT EXISTS (
  SELECT 1
  FROM `paymentEvents` AS pe
  WHERE pe.`paymentId` = p.`id`
    AND pe.`eventType` IN ('created', 'order_created')
);--> statement-breakpoint
