SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verificationStatus'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `verificationStatus` enum(''unverified'',''pending'',''approved'',''rejected'') NOT NULL DEFAULT ''unverified'''
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verificationNote'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `verificationNote` text NULL'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verifiedBy'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `verifiedBy` int NULL'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'verifiedAt'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `verifiedAt` timestamp NULL'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profileImageUrl'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `profileImageUrl` varchar(1000) NULL'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'birthdate'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `birthdate` timestamp NULL'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'),
  'SELECT 1',
  'ALTER TABLE `users` ADD COLUMN `phone` varchar(40) NULL'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
--> statement-breakpoint
SET @agricoop_ddl = IF(
  EXISTS(
    SELECT 1 FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'verifiedBy'
      AND REFERENCED_TABLE_NAME = 'users'
      AND REFERENCED_COLUMN_NAME = 'id'
  ),
  'SELECT 1',
  'ALTER TABLE `users` ADD CONSTRAINT `users_verifiedBy_users_id_fk` FOREIGN KEY (`verifiedBy`) REFERENCES `users` (`id`) ON DELETE NO ACTION ON UPDATE NO ACTION'
);
--> statement-breakpoint
PREPARE agricoop_stmt FROM @agricoop_ddl;
--> statement-breakpoint
EXECUTE agricoop_stmt;
--> statement-breakpoint
DEALLOCATE PREPARE agricoop_stmt;
