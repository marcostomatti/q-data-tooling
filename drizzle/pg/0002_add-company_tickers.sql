CREATE TABLE "company_tickers" (
	"ticker" text PRIMARY KEY NOT NULL,
	"cik" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_tickers" ADD CONSTRAINT "company_tickers_cik_companies_cik_fk" FOREIGN KEY ("cik") REFERENCES "public"."companies"("cik") ON DELETE cascade ON UPDATE no action;