-- LEGACY MYSQL DIALECT ONLY. Do not execute against Supabase/PostgreSQL.
-- PostgreSQL migration output is isolated by drizzle.config.ts under
-- drizzle/postgres-migrations; convert/review this logic before porting it.

ALTER TABLE `orders` ADD `demoSeedKey` varchar(80);--> statement-breakpoint
ALTER TABLE `orders` ADD CONSTRAINT `orders_demo_seed_key_idx` UNIQUE(`demoSeedKey`);