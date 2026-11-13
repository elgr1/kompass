CREATE TABLE `blocks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_key` text,
	`title` text NOT NULL,
	`course_id` text,
	`kind` text NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`plan_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `blocks_start_idx` ON `blocks` (`start_at`);--> statement-breakpoint
CREATE TABLE `exam_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`course_id` text,
	`exam_at` integer NOT NULL,
	`topics` text NOT NULL,
	`old_exams` integer NOT NULL,
	`buffer_days` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`work_key` text,
	`title` text NOT NULL,
	`course_id` text,
	`work_type` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`target_min` integer
);
--> statement-breakpoint
CREATE INDEX `time_work_idx` ON `time_entries` (`work_key`);--> statement-breakpoint
CREATE TABLE `work_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`estimate_min` integer,
	`work_type` text
);
