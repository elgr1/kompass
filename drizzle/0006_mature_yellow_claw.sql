CREATE TABLE `file_texts` (
	`item_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`text` text NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`error` text,
	`extracted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `opened` (
	`item_id` text PRIMARY KEY NOT NULL,
	`opened_at` integer NOT NULL
);
