CREATE TABLE `applications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`company` text NOT NULL,
	`role` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`deadline` text,
	`url` text,
	`cv_version` text,
	`letter_version` text,
	`follow_up_at` text,
	`applied_at` text,
	`doc_id` integer,
	`task_id` integer,
	`follow_task_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `career_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`kind` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text,
	`location` text,
	`url` text
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`email` text,
	`link` text,
	`met_at` text DEFAULT '' NOT NULL,
	`last_contacted` text,
	`nudge_days` integer DEFAULT 90 NOT NULL,
	`notes` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `degree_courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`hp_tenths` integer NOT NULL,
	`grade` text,
	`date` text,
	`status` text NOT NULL,
	`term` text,
	`category` text DEFAULT '' NOT NULL,
	`prereq` text DEFAULT '' NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exams` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_item_id` text,
	`title` text NOT NULL,
	`course_id` text,
	`exam_at` integer NOT NULL,
	`reg_deadline` text,
	`registered` integer DEFAULT false NOT NULL,
	`retake` integer DEFAULT false NOT NULL,
	`result` text,
	`task_id` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exams_source_item_id_unique` ON `exams` (`source_item_id`);--> statement-breakpoint
CREATE TABLE `milestones` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`done` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`goal` text DEFAULT '' NOT NULL,
	`status` text NOT NULL,
	`weekly_budget_min` integer DEFAULT 0 NOT NULL,
	`repo_url` text,
	`docs_url` text,
	`target_date` text,
	`doc_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `courses` ADD `teachers` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` integer;