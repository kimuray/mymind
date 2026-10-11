CREATE TABLE `daily_records` (
	`day` text PRIMARY KEY,
	`record_json` text NOT NULL,
	`generated_at` text NOT NULL,
	`source` text NOT NULL
);
