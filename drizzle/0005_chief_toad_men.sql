ALTER TABLE `cooperatives` ADD `normalizedName` varchar(180) NULL;--> statement-breakpoint
UPDATE `cooperatives` SET `normalizedName` = LOWER(REGEXP_REPLACE(`name`, '[[:space:][:punct:]]+', ''));--> statement-breakpoint
ALTER TABLE `cooperatives` MODIFY COLUMN `normalizedName` varchar(180) NOT NULL;--> statement-breakpoint
ALTER TABLE `cooperatives` ADD CONSTRAINT `cooperatives_normalized_name_idx` UNIQUE(`normalizedName`);