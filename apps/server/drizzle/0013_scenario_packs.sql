ALTER TABLE `series` ADD `scenario_pack` text DEFAULT 'temple' NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `subject_type` text DEFAULT 'temple' NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `aspect_ratio` text DEFAULT '16:9' NOT NULL;