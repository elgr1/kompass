CREATE TABLE `changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`course_id` text,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`html_url` text,
	`diffs` text NOT NULL,
	`triage` text NOT NULL,
	`detected_at` integer NOT NULL,
	`sync_run_id` integer NOT NULL,
	`read_at` integer,
	`snoozed_until` integer,
	`task_id` text
);
--> statement-breakpoint
CREATE INDEX `changes_detected_idx` ON `changes` (`detected_at`);--> statement-breakpoint
CREATE INDEX `changes_item_idx` ON `changes` (`item_id`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`name` text NOT NULL,
	`short_name` text NOT NULL,
	`code` text,
	`term` text,
	`html_url` text,
	`color` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`scope` text NOT NULL,
	`course_id` text,
	`title` text NOT NULL,
	`html_url` text,
	`start_at` integer,
	`end_at` integer,
	`due_at` integer,
	`all_day` integer DEFAULT false NOT NULL,
	`location` text,
	`body_text` text,
	`fields` text NOT NULL,
	`comparable` text NOT NULL,
	`raw` text,
	`hash` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`changed_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `items_scope_idx` ON `items` (`scope`);--> statement-breakpoint
CREATE INDEX `items_kind_idx` ON `items` (`kind`);--> statement-breakpoint
CREATE INDEX `items_course_idx` ON `items` (`course_id`);--> statement-breakpoint
CREATE INDEX `items_due_idx` ON `items` (`due_at`);--> statement-breakpoint
CREATE INDEX `items_start_idx` ON `items` (`start_at`);--> statement-breakpoint
CREATE TABLE `scopes` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`baseline_at` integer,
	`last_ok_at` integer,
	`last_status` text NOT NULL,
	`last_error` text,
	`item_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` text NOT NULL,
	`sync_run_id` integer NOT NULL,
	`captured_at` integer NOT NULL,
	`hash` text NOT NULL,
	`comparable` text NOT NULL,
	`raw` text
);
--> statement-breakpoint
CREATE INDEX `snapshots_item_idx` ON `snapshots` (`item_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`error` text,
	`stats` text
);
