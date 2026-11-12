CREATE TABLE `company_tickers` (
	`ticker` text PRIMARY KEY NOT NULL,
	`cik` integer NOT NULL,
	FOREIGN KEY (`cik`) REFERENCES `companies`(`cik`) ON UPDATE no action ON DELETE cascade
);
