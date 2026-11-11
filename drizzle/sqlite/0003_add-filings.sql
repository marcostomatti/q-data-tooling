CREATE TABLE `filings` (
	`accession_number` text PRIMARY KEY NOT NULL,
	`cik` integer NOT NULL,
	`form` text NOT NULL,
	`base_form` text NOT NULL,
	`is_amendment` integer NOT NULL,
	`filing_date` text NOT NULL,
	`report_date` text,
	`accepted_at` text NOT NULL,
	`act` text,
	`file_number` text,
	`film_number` text,
	`items` text DEFAULT '[]' NOT NULL,
	`size_bytes` integer NOT NULL,
	`is_xbrl` integer NOT NULL,
	`is_inline_xbrl` integer NOT NULL,
	`primary_document` text NOT NULL,
	`description` text,
	`document_url` text NOT NULL,
	`index_url` text NOT NULL,
	`folder_json_url` text NOT NULL,
	`inline_xbrl_viewer_url` text,
	`raw_xml_url` text,
	FOREIGN KEY (`cik`) REFERENCES `companies`(`cik`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `filings_cik_filing_date_idx` ON `filings` (`cik`,"filing_date" desc);--> statement-breakpoint
CREATE INDEX `filings_cik_base_form_idx` ON `filings` (`cik`,`base_form`);