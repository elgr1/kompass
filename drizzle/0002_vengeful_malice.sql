CREATE TABLE `sent_notifications` (
	`key` text PRIMARY KEY NOT NULL,
	`sent_at` integer NOT NULL,
	`title` text NOT NULL,
	`ok` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`item_id` text,
	`course_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`quote` text NOT NULL,
	`due_at` integer NOT NULL,
	`has_time` integer NOT NULL,
	`precision` text NOT NULL,
	`confidence` integer NOT NULL,
	`source_url` text,
	`source_label` text NOT NULL,
	`status` text NOT NULL,
	`task_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_key_unique` ON `suggestions` (`key`);--> statement-breakpoint
CREATE INDEX `suggestions_status_idx` ON `suggestions` (`status`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`notes` text,
	`due_at` integer,
	`has_time` integer DEFAULT false NOT NULL,
	`course_id` text,
	`tags` text NOT NULL,
	`kind` text DEFAULT 'task' NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`source_item_id` text,
	`source_url` text,
	`source_quote` text,
	`created_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `tasks_due_idx` ON `tasks` (`due_at`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
ALTER TABLE `courses` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `courses` ADD `nicknames` text DEFAULT '' NOT NULL;