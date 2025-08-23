CREATE TABLE "geocode_cache_v2" (
	"id" serial PRIMARY KEY NOT NULL,
	"search_term" text NOT NULL,
	"original_address" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"geohash" text NOT NULL,
	"formatted_address" text,
	"locality" text,
	"sub_locality" text,
	"state" text,
	"country" text DEFAULT 'India',
	"postal_code" text,
	"confidence" numeric(3, 2) DEFAULT '1.0',
	"hit_count" integer DEFAULT 1,
	"last_used" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "geocode_cache_v2_search_term_unique" UNIQUE("search_term")
);
--> statement-breakpoint
CREATE TABLE "user_search_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"search_term" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"result_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "queues" DROP CONSTRAINT "queues_user_station_unique";--> statement-breakpoint
ALTER TABLE "charging_sessions" ALTER COLUMN "total_cost" SET DATA TYPE numeric(10, 2);--> statement-breakpoint
ALTER TABLE "charging_sessions" ALTER COLUMN "status" SET DEFAULT 'initiated';--> statement-breakpoint
ALTER TABLE "charging_stations" ALTER COLUMN "price_per_kwh" SET DEFAULT '10.00';--> statement-breakpoint
ALTER TABLE "charging_stations" ALTER COLUMN "max_queue_length" SET DEFAULT 10;--> statement-breakpoint
ALTER TABLE "charging_stations" ALTER COLUMN "average_session_minutes" SET DEFAULT 30;--> statement-breakpoint
ALTER TABLE "charging_stations" ALTER COLUMN "owner_whatsapp_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "session_id" varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "duration" integer;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "energy_delivered" numeric(8, 3);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "peak_power_kw" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "average_power_kw" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD COLUMN "rate_per_kwh" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "queues" ADD COLUMN "reminder_sent" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "station_owners" ADD COLUMN "phone_number" varchar(20);--> statement-breakpoint
ALTER TABLE "station_owners" ADD COLUMN "email" varchar(150);--> statement-breakpoint
ALTER TABLE "station_owners" ADD COLUMN "business_name" varchar(200);--> statement-breakpoint
ALTER TABLE "station_owners" ADD COLUMN "business_type" varchar(50);--> statement-breakpoint
ALTER TABLE "station_owners" ADD COLUMN "is_verified" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "station_owners" ADD COLUMN "verification_documents" jsonb;--> statement-breakpoint
CREATE INDEX "geocode_v2_search_term_idx" ON "geocode_cache_v2" USING btree ("search_term");--> statement-breakpoint
CREATE INDEX "geocode_v2_geohash_idx" ON "geocode_cache_v2" USING btree ("geohash");--> statement-breakpoint
CREATE INDEX "geocode_v2_locality_idx" ON "geocode_cache_v2" USING btree ("locality");--> statement-breakpoint
CREATE INDEX "search_history_user_idx" ON "user_search_history" USING btree ("user_whatsapp");--> statement-breakpoint
CREATE INDEX "search_history_term_idx" ON "user_search_history" USING btree ("search_term");--> statement-breakpoint
CREATE INDEX "search_history_date_idx" ON "user_search_history" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_user_whatsapp_users_whatsapp_id_fk" FOREIGN KEY ("user_whatsapp") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_user_whatsapp_users_whatsapp_id_fk" FOREIGN KEY ("user_whatsapp") REFERENCES "public"."users"("whatsapp_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" DROP COLUMN "duration_minutes";--> statement-breakpoint
ALTER TABLE "charging_sessions" DROP COLUMN "energy_consumed_kwh";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "is_reserved";--> statement-breakpoint
ALTER TABLE "queues" DROP COLUMN "reserved_at";--> statement-breakpoint
ALTER TABLE "station_owners" DROP COLUMN "permissions";--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_session_id_unique" UNIQUE("session_id");