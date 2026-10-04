CREATE TABLE `notifications_sent` (
	`kind` text NOT NULL,
	`day` text NOT NULL,
	`sent_at` text NOT NULL,
	CONSTRAINT `notifications_sent_pk` PRIMARY KEY(`kind`, `day`)
);
