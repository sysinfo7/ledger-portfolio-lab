CREATE TABLE `paper_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`initial_cash` integer NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`state_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_candles` (
	`id` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`symbol` text NOT NULL,
	`date` text NOT NULL,
	`close` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `paper_history` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`mode` text NOT NULL,
	`date` text NOT NULL,
	`value` integer NOT NULL,
	`invested` integer NOT NULL
);
