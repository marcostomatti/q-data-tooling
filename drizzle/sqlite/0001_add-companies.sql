CREATE TABLE `companies` (
	`cik` integer PRIMARY KEY NOT NULL,
	`cik10` text NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`selected` integer DEFAULT false NOT NULL,
	`exchanges` text DEFAULT '[]' NOT NULL,
	`sic` text,
	`sic_description` text,
	`category` text,
	`fiscal_year_end` text,
	`filings_synced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companies_cik10_unique` ON `companies` (`cik10`);--> statement-breakpoint
CREATE INDEX `companies_name_idx` ON `companies` (`name`);--> statement-breakpoint
CREATE INDEX `companies_selected_idx` ON `companies` (`selected`);