CREATE TABLE `day_plans` (
	`day` text NOT NULL,
	`task_id` text NOT NULL,
	`position` real NOT NULL,
	CONSTRAINT `day_plans_pk` PRIMARY KEY(`day`, `task_id`),
	CONSTRAINT `fk_day_plans_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`type` text NOT NULL,
	`from_status` text,
	`to_status` text,
	`at` text NOT NULL,
	`day` text NOT NULL,
	CONSTRAINT `fk_task_events_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY,
	`parent_id` text,
	`title` text NOT NULL,
	`note_md` text,
	`status` text NOT NULL,
	`sort_order` real NOT NULL,
	`created_at` text NOT NULL,
	`last_touched_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`)
);
