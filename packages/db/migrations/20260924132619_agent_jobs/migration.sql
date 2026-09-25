CREATE TABLE `agent_jobs` (
	`id` text PRIMARY KEY,
	`kind` text NOT NULL,
	`period` text NOT NULL,
	`agent` text NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `conditions` (
	`day` text PRIMARY KEY,
	`ai_level` integer,
	`ai_reason` text,
	`user_level` integer,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `feedbacks` (
	`id` text PRIMARY KEY,
	`scope` text NOT NULL,
	`period` text NOT NULL,
	`job_id` text,
	`content_json` text NOT NULL,
	`agent` text NOT NULL,
	`prompt_version` text NOT NULL,
	`is_partial` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_feedbacks_job_id_agent_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `agent_jobs`(`id`)
);
