CREATE TABLE "companies" (
	"cik" integer PRIMARY KEY NOT NULL,
	"cik10" text NOT NULL,
	"ticker" text NOT NULL,
	"name" text NOT NULL,
	"selected" boolean DEFAULT false NOT NULL,
	"exchanges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sic" text,
	"sic_description" text,
	"category" text,
	"fiscal_year_end" text,
	"filings_synced_at" timestamp with time zone,
	CONSTRAINT "companies_cik10_unique" UNIQUE("cik10")
);
--> statement-breakpoint
CREATE INDEX "companies_name_idx" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "companies_selected_idx" ON "companies" USING btree ("selected");