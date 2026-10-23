CREATE TYPE "public"."breaker_state" AS ENUM('closed', 'open', 'half_open');--> statement-breakpoint
CREATE TYPE "public"."endpoint_status" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."attempt_outcome" AS ENUM('success', 'http_error', 'timeout', 'network_error', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('pending', 'in_progress', 'retrying', 'succeeded', 'dead', 'cancelled');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by_user_id" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoint_health" (
	"endpoint_id" text PRIMARY KEY NOT NULL,
	"state" "breaker_state" DEFAULT 'closed' NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"opened_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_probe_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret_encrypted" text NOT NULL,
	"previous_secret_encrypted" text,
	"previous_secret_expires_at" timestamp with time zone,
	"status" "endpoint_status" DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"disabled_at" timestamp with time zone,
	"event_types" text[] DEFAULT '{}' NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"rate_limit_per_second" integer DEFAULT 10 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"replay_of_delivery_id" text,
	"status" "delivery_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_response_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" "attempt_outcome" NOT NULL,
	"requestHeaders" jsonb NOT NULL,
	"response_status" integer,
	"responseHeaders" jsonb,
	"response_body_snippet" text,
	"error_message" text,
	"duration_ms" integer,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_stats_hourly" (
	"organization_id" text NOT NULL,
	"endpoint_id" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"attempts_total" integer NOT NULL,
	"attempts_succeeded" integer NOT NULL,
	"attempts_failed" integer NOT NULL,
	"deliveries_dead" integer NOT NULL,
	"latency_p50_ms" integer,
	"latency_p95_ms" integer,
	"latency_p99_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_stats_hourly_pk" PRIMARY KEY("organization_id","endpoint_id","bucket_start")
);
--> statement-breakpoint
ALTER TABLE "endpoint_health" ADD CONSTRAINT "endpoint_health_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_endpoint_id_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uidx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "endpoints_org_idx" ON "endpoints" USING btree ("organization_id") WHERE deleted_at is null;--> statement-breakpoint
CREATE INDEX "endpoints_org_status_idx" ON "endpoints" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "events_org_idem_uidx" ON "events" USING btree ("organization_id","idempotency_key") WHERE idempotency_key is not null;--> statement-breakpoint
CREATE INDEX "events_org_created_idx" ON "events" USING btree ("organization_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "events_org_type_created_idx" ON "events" USING btree ("organization_id","type","created_at" desc);--> statement-breakpoint
CREATE UNIQUE INDEX "deliveries_event_endpoint_uidx" ON "deliveries" USING btree ("event_id","endpoint_id") WHERE replay_of_delivery_id is null;--> statement-breakpoint
CREATE INDEX "deliveries_org_created_idx" ON "deliveries" USING btree ("organization_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "deliveries_endpoint_created_idx" ON "deliveries" USING btree ("endpoint_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "deliveries_org_status_created_idx" ON "deliveries" USING btree ("organization_id","status","created_at" desc);--> statement-breakpoint
CREATE INDEX "deliveries_pending_idx" ON "deliveries" USING btree ("created_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "deliveries_retrying_idx" ON "deliveries" USING btree ("next_attempt_at") WHERE status = 'retrying';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_attempts_delivery_number_uidx" ON "delivery_attempts" USING btree ("delivery_id","attempt_number");--> statement-breakpoint
CREATE INDEX "delivery_attempts_org_started_idx" ON "delivery_attempts" USING btree ("organization_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "delivery_attempts_endpoint_started_idx" ON "delivery_attempts" USING btree ("endpoint_id","started_at" desc);--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("organization_id","created_at" desc);--> statement-breakpoint
CREATE INDEX "delivery_stats_hourly_bucket_idx" ON "delivery_stats_hourly" USING btree ("bucket_start");