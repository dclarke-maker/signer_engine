CREATE TABLE `capture_sessions` (
	`id` varchar(64) NOT NULL,
	`signerId` int NOT NULL,
	`promptId` varchar(16) NOT NULL,
	`category` enum('declarative','interrogative','negation','temporal','utility') NOT NULL,
	`status` enum('recording','pending_upload','stored','superseded','skipped','failed') NOT NULL DEFAULT 'recording',
	`skipReason` varchar(256),
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `capture_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `consent_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`signerId` int NOT NULL,
	`consentVersion` varchar(32) NOT NULL,
	`scopes` text NOT NULL,
	`grantedAt` timestamp NOT NULL DEFAULT (now()),
	`withdrawnAt` timestamp,
	CONSTRAINT `consent_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feedback_votes` (
	`id` varchar(64) NOT NULL,
	`translationJobId` varchar(64) NOT NULL,
	`signerId` int,
	`vote` enum('accurate','needs_correction') NOT NULL,
	`note` varchar(280),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feedback_votes_id` PRIMARY KEY(`id`),
	CONSTRAINT `feedback_vote_job_signer_uq` UNIQUE(`translationJobId`,`signerId`)
);
--> statement-breakpoint
CREATE TABLE `landmark_sequences` (
	`id` varchar(64) NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`schemaVersion` int NOT NULL,
	`extractorId` varchar(64) NOT NULL,
	`frameCount` int NOT NULL,
	`targetFps` int NOT NULL,
	`achievedFps` int NOT NULL,
	`durationMs` int NOT NULL,
	`storageKey` varchar(512) NOT NULL,
	`sizeBytes` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `landmark_sequences_id` PRIMARY KEY(`id`),
	CONSTRAINT `landmark_sequences_sessionId_unique` UNIQUE(`sessionId`),
	CONSTRAINT `landmark_sequences_storageKey_unique` UNIQUE(`storageKey`)
);
--> statement-breakpoint
CREATE TABLE `nmm_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`type` enum('eyebrow_raise','headshake','shoulder_shrug','forward_lean','body_tilt') NOT NULL,
	`startFrame` int NOT NULL,
	`endFrame` int NOT NULL,
	`confidenceBp` int NOT NULL,
	`ruleVersion` varchar(64) NOT NULL,
	CONSTRAINT `nmm_tags_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qualitative_ratings` (
	`id` varchar(64) NOT NULL,
	`translationJobId` varchar(64) NOT NULL,
	`signerId` int,
	`naturalness` int NOT NULL,
	`grammaticality` int NOT NULL,
	`usefulness` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qualitative_ratings_id` PRIMARY KEY(`id`),
	CONSTRAINT `qualitative_rating_job_signer_uq` UNIQUE(`translationJobId`,`signerId`)
);
--> statement-breakpoint
CREATE TABLE `sentence_prompts` (
	`id` varchar(16) NOT NULL,
	`category` enum('declarative','interrogative','negation','temporal','utility') NOT NULL,
	`orderIndex` int NOT NULL,
	`textEnglish` varchar(512) NOT NULL,
	`expectedNmms` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sentence_prompts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `split_assignments` (
	`signerId` int NOT NULL,
	`split` enum('train','validation','test') NOT NULL,
	`seed` varchar(64) NOT NULL,
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `split_assignments_signerId` PRIMARY KEY(`signerId`)
);
--> statement-breakpoint
CREATE TABLE `translation_jobs` (
	`id` varchar(64) NOT NULL,
	`sessionId` varchar(64) NOT NULL,
	`status` enum('pending','processing','complete','failed') NOT NULL DEFAULT 'pending',
	`englishResponse` text,
	`confidenceBp` int,
	`modelVersion` varchar(64) NOT NULL,
	`latencyMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `translation_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `capture_session_signer_id_idx` ON `capture_sessions` (`signerId`);--> statement-breakpoint
CREATE INDEX `capture_session_prompt_idx` ON `capture_sessions` (`signerId`,`promptId`);--> statement-breakpoint
CREATE INDEX `consent_signer_id_idx` ON `consent_records` (`signerId`);--> statement-breakpoint
CREATE INDEX `nmm_tag_session_idx` ON `nmm_tags` (`sessionId`);--> statement-breakpoint
CREATE INDEX `translation_job_session_idx` ON `translation_jobs` (`sessionId`);