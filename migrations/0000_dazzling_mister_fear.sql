CREATE TABLE "admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_id" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true,
	"permissions" jsonb DEFAULT '["manage_owners", "manage_users", "view_analytics"]' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "admins_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_whatsapp_id" varchar(20) NOT NULL,
	"actor_type" varchar(20) NOT NULL,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50),
	"resource_id" varchar(50),
	"old_values" jsonb,
	"new_values" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "charging_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"station_id" integer NOT NULL,
	"queue_id" integer,
	"start_time" timestamp,
	"end_time" timestamp,
	"duration_minutes" integer,
	"energy_consumed_kwh" numeric(6, 2),
	"total_cost" numeric(8, 2),
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "charging_stations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"total_ports" integer DEFAULT 1 NOT NULL,
	"available_ports" integer DEFAULT 1 NOT NULL,
	"connector_types" jsonb NOT NULL,
	"max_power_kw" integer DEFAULT 50 NOT NULL,
	"price_per_kwh" numeric(5, 2) NOT NULL,
	"is_active" boolean DEFAULT true,
	"is_open" boolean DEFAULT true,
	"is_paused" boolean DEFAULT false,
	"max_queue_length" integer DEFAULT 5,
	"current_queue_length" integer DEFAULT 0,
	"average_session_minutes" integer DEFAULT 45,
	"owner_whatsapp_id" varchar(20),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "geocode_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"latitude" numeric(10, 8) NOT NULL,
	"longitude" numeric(11, 8) NOT NULL,
	"hit_count" integer DEFAULT 1,
	"last_used" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "geocode_cache_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "queues" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_whatsapp" varchar(20) NOT NULL,
	"station_id" integer NOT NULL,
	"position" integer NOT NULL,
	"estimated_wait_minutes" integer,
	"reservation_expiry" timestamp,
	"is_reserved" boolean DEFAULT false,
	"reserved_at" timestamp,
	"status" varchar(20) DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "queues_user_station_unique" UNIQUE("user_whatsapp","station_id")
);
--> statement-breakpoint
CREATE TABLE "station_owners" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_id" varchar(20) NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true,
	"permissions" jsonb DEFAULT '["manage_own_stations"]' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "station_owners_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"whatsapp_id" varchar(20) NOT NULL,
	"name" varchar(100),
	"phone_number" varchar(20),
	"ev_model" varchar(100),
	"connector_type" varchar(20),
	"charging_intent" varchar(50),
	"queue_preference" varchar(30),
	"is_active" boolean DEFAULT true,
	"is_banned" boolean DEFAULT false,
	"preferences_captured" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_whatsapp_id_unique" UNIQUE("whatsapp_id")
);
--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_station_id_charging_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."charging_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charging_sessions" ADD CONSTRAINT "charging_sessions_queue_id_queues_id_fk" FOREIGN KEY ("queue_id") REFERENCES "public"."queues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queues" ADD CONSTRAINT "queues_station_id_charging_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."charging_stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admins_whatsapp_id_idx" ON "admins" USING btree ("whatsapp_id");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_whatsapp_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_date_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "charging_sessions" USING btree ("user_whatsapp");--> statement-breakpoint
CREATE INDEX "sessions_station_idx" ON "charging_sessions" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "sessions_status_idx" ON "charging_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_date_idx" ON "charging_sessions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stations_location_idx" ON "charging_stations" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "stations_owner_idx" ON "charging_stations" USING btree ("owner_whatsapp_id");--> statement-breakpoint
CREATE INDEX "stations_active_idx" ON "charging_stations" USING btree ("is_active","is_open");--> statement-breakpoint
CREATE INDEX "geocode_address_idx" ON "geocode_cache" USING btree ("address");--> statement-breakpoint
CREATE INDEX "geocode_location_idx" ON "geocode_cache" USING btree ("latitude","longitude");--> statement-breakpoint
CREATE INDEX "queues_station_position_idx" ON "queues" USING btree ("station_id","position");--> statement-breakpoint
CREATE INDEX "queues_status_idx" ON "queues" USING btree ("status");--> statement-breakpoint
CREATE INDEX "queues_expiry_idx" ON "queues" USING btree ("reservation_expiry");--> statement-breakpoint
CREATE INDEX "owners_whatsapp_id_idx" ON "station_owners" USING btree ("whatsapp_id");--> statement-breakpoint
CREATE INDEX "users_whatsapp_id_idx" ON "users" USING btree ("whatsapp_id");--> statement-breakpoint
CREATE INDEX "users_name_idx" ON "users" USING btree ("name");