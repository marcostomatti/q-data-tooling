CREATE TABLE "filings" (
	"accession_number" text PRIMARY KEY NOT NULL,
	"cik" integer NOT NULL,
	"form" text NOT NULL,
	"base_form" text NOT NULL,
	"is_amendment" boolean NOT NULL,
	"filing_date" date NOT NULL,
	"report_date" date,
	"accepted_at" text NOT NULL,
	"act" text,
	"file_number" text,
	"film_number" text,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"size_bytes" integer NOT NULL,
	"is_xbrl" boolean NOT NULL,
	"is_inline_xbrl" boolean NOT NULL,
	"primary_document" text NOT NULL,
	"description" text,
	"document_url" text NOT NULL,
	"index_url" text NOT NULL,
	"folder_json_url" text NOT NULL,
	"inline_xbrl_viewer_url" text,
	"raw_xml_url" text
);
--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_cik_companies_cik_fk" FOREIGN KEY ("cik") REFERENCES "public"."companies"("cik") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "filings_cik_filing_date_idx" ON "filings" USING btree ("cik","filing_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "filings_cik_base_form_idx" ON "filings" USING btree ("cik","base_form");