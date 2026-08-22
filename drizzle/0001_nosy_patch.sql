CREATE TABLE `signer_accounts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`email` varchar(320) NOT NULL,
	`displayName` varchar(160),
	`passwordHash` varchar(255),
	`status` enum('invited','active','disabled') NOT NULL DEFAULT 'invited',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`lastSignedIn` timestamp,
	CONSTRAINT `signer_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `signer_accounts_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `signer_captures` (
	`id` varchar(64) NOT NULL,
	`signerId` int NOT NULL,
	`status` enum('accepted','uploaded','failed') NOT NULL DEFAULT 'accepted',
	`mimeType` varchar(128) NOT NULL,
	`uploadKey` varchar(512) NOT NULL,
	`clientRecordedAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signer_captures_id` PRIMARY KEY(`id`),
	CONSTRAINT `signer_captures_uploadKey_unique` UNIQUE(`uploadKey`)
);
--> statement-breakpoint
CREATE TABLE `signer_invitations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`signerId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signer_invitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `signer_invitations_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `signer_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`signerId` int NOT NULL,
	`tokenHash` varchar(128) NOT NULL,
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `signer_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `signer_sessions_tokenHash_unique` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE INDEX `signer_capture_signer_id_idx` ON `signer_captures` (`signerId`);--> statement-breakpoint
CREATE INDEX `signer_invitation_signer_id_idx` ON `signer_invitations` (`signerId`);--> statement-breakpoint
CREATE INDEX `signer_session_token_hash_idx` ON `signer_sessions` (`tokenHash`);