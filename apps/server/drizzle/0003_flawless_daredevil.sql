CREATE TABLE "org_settings" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"retention_days" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
