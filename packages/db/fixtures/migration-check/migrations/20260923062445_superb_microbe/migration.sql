CREATE TABLE `item_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`item_id` text NOT NULL,
	`kind` text NOT NULL,
	CONSTRAINT `fk_item_events_item_id_items_id_fk` FOREIGN KEY (`item_id`) REFERENCES `items`(`id`)
);
--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`status` text NOT NULL
);
