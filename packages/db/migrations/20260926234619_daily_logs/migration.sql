CREATE TABLE `daily_logs` (
	`day` text PRIMARY KEY,
	`thoughts_md` text DEFAULT '' NOT NULL,
	`learning_md` text DEFAULT '' NOT NULL,
	`plan_confirmed_at` text,
	`updated_at` text NOT NULL
);
