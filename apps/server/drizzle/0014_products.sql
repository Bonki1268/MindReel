-- SQLite 不能直接把 NOT NULL 改成 nullable，所以重建 photos 與 videos（複製資料、換名）。
-- 重建期間外鍵必須關閉：client.ts 的 openDatabase 在套用 migration 前先關掉外鍵，套用完再打開並檢查。
CREATE TABLE `product_board_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`board_id` text NOT NULL,
	`version` integer NOT NULL,
	`image_model` text NOT NULL,
	`appearance_locks` text NOT NULL,
	`default_lighting` text NOT NULL,
	`confirmed_at` text,
	FOREIGN KEY (`board_id`) REFERENCES `product_boards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_board_versions_board_version_uq` ON `product_board_versions` (`board_id`,`version`);--> statement-breakpoint
CREATE TABLE `product_boards` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`product_id` text NOT NULL,
	`current_version_id` text,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_boards_series_product_uq` ON `product_boards` (`series_id`,`product_id`);--> statement-breakpoint
CREATE TABLE `product_views` (
	`id` text PRIMARY KEY NOT NULL,
	`board_version_id` text NOT NULL,
	`view_key` text NOT NULL,
	`view_name` text NOT NULL,
	`source` text NOT NULL,
	`photo_id` text,
	`asset_id` text,
	`confirmed` integer DEFAULT false NOT NULL,
	`created_from_video_id` text,
	FOREIGN KEY (`board_version_id`) REFERENCES `product_board_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_from_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_views_version_view_uq` ON `product_views` (`board_version_id`,`view_key`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`category` text NOT NULL,
	`selling_points` text NOT NULL,
	`price` integer,
	`price_note` text,
	`specs` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `products_series_idx` ON `products` (`series_id`);--> statement-breakpoint
CREATE TABLE `__new_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`temple_id` text,
	`product_id` text,
	`video_id` text,
	`original_asset_id` text NOT NULL,
	`deidentified_asset_id` text NOT NULL,
	`view_key` text,
	`deid_boxes` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`original_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deidentified_asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_photos`("id", "series_id", "temple_id", "product_id", "video_id", "original_asset_id", "deidentified_asset_id", "view_key", "deid_boxes", "created_at") SELECT "id", "series_id", "temple_id", NULL, "video_id", "original_asset_id", "deidentified_asset_id", "view_key", "deid_boxes", "created_at" FROM `photos`;--> statement-breakpoint
DROP TABLE `photos`;--> statement-breakpoint
ALTER TABLE `__new_photos` RENAME TO `photos`;--> statement-breakpoint
CREATE INDEX `photos_series_temple_idx` ON `photos` (`series_id`,`temple_id`);--> statement-breakpoint
CREATE INDEX `photos_product_idx` ON `photos` (`product_id`);--> statement-breakpoint
CREATE TABLE `__new_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`temple_id` text,
	`stage` text NOT NULL,
	`image_model` text NOT NULL,
	`video_model` text NOT NULL,
	`models_locked_at` text,
	`temple_board_version_id` text,
	`one_pass` integer DEFAULT 0 NOT NULL,
	`user_temple_notes` text DEFAULT '' NOT NULL,
	`creative_input` text,
	`cost_limit` integer,
	`copied_from_video_id` text,
	`series_snapshot` text,
	`subject_type` text DEFAULT 'temple' NOT NULL,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`product_id` text,
	`product_snapshot` text,
	`product_board_version_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_videos`("id", "series_id", "temple_id", "stage", "image_model", "video_model", "models_locked_at", "temple_board_version_id", "one_pass", "user_temple_notes", "creative_input", "cost_limit", "copied_from_video_id", "series_snapshot", "subject_type", "aspect_ratio", "product_id", "product_snapshot", "product_board_version_id", "created_at", "updated_at") SELECT "id", "series_id", "temple_id", "stage", "image_model", "video_model", "models_locked_at", "temple_board_version_id", "one_pass", "user_temple_notes", "creative_input", "cost_limit", "copied_from_video_id", "series_snapshot", "subject_type", "aspect_ratio", NULL, NULL, NULL, "created_at", "updated_at" FROM `videos`;--> statement-breakpoint
DROP TABLE `videos`;--> statement-breakpoint
ALTER TABLE `__new_videos` RENAME TO `videos`;--> statement-breakpoint
CREATE INDEX `videos_series_idx` ON `videos` (`series_id`);