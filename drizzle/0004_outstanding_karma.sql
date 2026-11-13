CREATE TABLE `databases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`props` text NOT NULL,
	`views` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `doc_links` (
	`from_id` integer NOT NULL,
	`to_id` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `doc_links_to_idx` ON `doc_links` (`to_id`);--> statement-breakpoint
CREATE INDEX `doc_links_from_idx` ON `doc_links` (`from_id`);--> statement-breakpoint
CREATE TABLE `docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`parent_id` integer,
	`database_id` integer,
	`props` text NOT NULL,
	`course_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `docs_db_idx` ON `docs` (`database_id`);--> statement-breakpoint
CREATE INDEX `docs_parent_idx` ON `docs` (`parent_id`);