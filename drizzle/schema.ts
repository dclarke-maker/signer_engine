import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

import { CORPUS_CATEGORIES } from "../shared/corpus";
import {
  feedbackVoteValues,
  nmmTypes,
  sessionStatuses,
  translationStatuses,
} from "../shared/workflow";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const signerAccounts = mysqlTable("signer_accounts", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  displayName: varchar("displayName", { length: 160 }),
  passwordHash: varchar("passwordHash", { length: 255 }),
  status: mysqlEnum("status", ["invited", "active", "disabled"]).default("invited").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn"),
});

export const signerInvitations = mysqlTable(
  "signer_invitations",
  {
    id: int("id").autoincrement().primaryKey(),
    signerId: int("signerId").notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    acceptedAt: timestamp("acceptedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("signer_invitation_signer_id_idx").on(table.signerId)],
);

export const signerSessions = mysqlTable(
  "signer_sessions",
  {
    id: int("id").autoincrement().primaryKey(),
    signerId: int("signerId").notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("signer_session_token_hash_idx").on(table.tokenHash)],
);

export type SignerAccount = typeof signerAccounts.$inferSelect;
export type SignerInvitation = typeof signerInvitations.$inferSelect;
export type SignerSession = typeof signerSessions.$inferSelect;
/* ------------------------------------------------------------------ *
 * Research corpus, capture sessions, and human-in-the-loop feedback.
 * Enums derive from the shared vocabularies so the schema and the
 * client types cannot drift. See design.md §11.
 * ------------------------------------------------------------------ */

export const sentencePrompts = mysqlTable("sentence_prompts", {
  id: varchar("id", { length: 16 }).primaryKey(),
  category: mysqlEnum("category", CORPUS_CATEGORIES).notNull(),
  orderIndex: int("orderIndex").notNull(),
  textEnglish: varchar("textEnglish", { length: 512 }).notNull(),
  /** JSON array of NmmType - markers this sentence is designed to elicit. */
  expectedNmms: text("expectedNmms").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const consentRecords = mysqlTable(
  "consent_records",
  {
    id: int("id").autoincrement().primaryKey(),
    signerId: int("signerId").notNull(),
    consentVersion: varchar("consentVersion", { length: 32 }).notNull(),
    /** JSON array - "participation" and optionally "workshop_calibration". */
    scopes: text("scopes").notNull(),
    grantedAt: timestamp("grantedAt").defaultNow().notNull(),
    withdrawnAt: timestamp("withdrawnAt"),
  },
  (table) => [index("consent_signer_id_idx").on(table.signerId)],
);

export const captureSessions = mysqlTable(
  "capture_sessions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    signerId: int("signerId").notNull(),
    promptId: varchar("promptId", { length: 16 }).notNull(),
    category: mysqlEnum("category", CORPUS_CATEGORIES).notNull(),
    status: mysqlEnum("status", sessionStatuses).default("recording").notNull(),
    skipReason: varchar("skipReason", { length: 256 }),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => [
    index("capture_session_signer_id_idx").on(table.signerId),
    index("capture_session_prompt_idx").on(table.signerId, table.promptId),
  ],
);

export const landmarkSequences = mysqlTable(
  "landmark_sequences",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    sessionId: varchar("sessionId", { length: 64 }).notNull().unique(),
    schemaVersion: int("schemaVersion").notNull(),
    extractorId: varchar("extractorId", { length: 64 }).notNull(),
    frameCount: int("frameCount").notNull(),
    targetFps: int("targetFps").notNull(),
    achievedFps: int("achievedFps").notNull(),
    durationMs: int("durationMs").notNull(),
    storageKey: varchar("storageKey", { length: 512 }).notNull().unique(),
    sizeBytes: int("sizeBytes").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  // sessionId is already unique, and MySQL backs a unique constraint with an
  // index, so no separate index is declared here.
);

export const nmmTags = mysqlTable(
  "nmm_tags",
  {
    id: int("id").autoincrement().primaryKey(),
    sessionId: varchar("sessionId", { length: 64 }).notNull(),
    type: mysqlEnum("type", nmmTypes).notNull(),
    startFrame: int("startFrame").notNull(),
    endFrame: int("endFrame").notNull(),
    /** Confidence 0-1, stored as basis points to avoid float drift. */
    confidenceBp: int("confidenceBp").notNull(),
    ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(),
  },
  (table) => [index("nmm_tag_session_idx").on(table.sessionId)],
);

export const translationJobs = mysqlTable(
  "translation_jobs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    sessionId: varchar("sessionId", { length: 64 }).notNull(),
    status: mysqlEnum("status", translationStatuses).default("pending").notNull(),
    englishResponse: text("englishResponse"),
    confidenceBp: int("confidenceBp"),
    modelVersion: varchar("modelVersion", { length: 64 }).notNull(),
    latencyMs: int("latencyMs"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  (table) => [index("translation_job_session_idx").on(table.sessionId)],
);

export const feedbackVotes = mysqlTable(
  "feedback_votes",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    translationJobId: varchar("translationJobId", { length: 64 }).notNull(),
    signerId: int("signerId"),
    vote: mysqlEnum("vote", feedbackVoteValues).notNull(),
    note: varchar("note", { length: 280 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    // MySQL treats NULLs as distinct, so anonymous votes are not constrained.
    uniqueIndex("feedback_vote_job_signer_uq").on(table.translationJobId, table.signerId),
  ],
);

export const qualitativeRatings = mysqlTable(
  "qualitative_ratings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    translationJobId: varchar("translationJobId", { length: 64 }).notNull(),
    signerId: int("signerId"),
    naturalness: int("naturalness").notNull(),
    grammaticality: int("grammaticality").notNull(),
    usefulness: int("usefulness").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("qualitative_rating_job_signer_uq").on(table.translationJobId, table.signerId),
  ],
);

export const splitAssignments = mysqlTable("split_assignments", {
  signerId: int("signerId").primaryKey(),
  split: mysqlEnum("split", ["train", "validation", "test"]).notNull(),
  seed: varchar("seed", { length: 64 }).notNull(),
  assignedAt: timestamp("assignedAt").defaultNow().notNull(),
});

export type SentencePrompt = typeof sentencePrompts.$inferSelect;
export type ConsentRecord = typeof consentRecords.$inferSelect;
export type CaptureSession = typeof captureSessions.$inferSelect;
export type LandmarkSequence = typeof landmarkSequences.$inferSelect;
export type NmmTag = typeof nmmTags.$inferSelect;
export type TranslationJob = typeof translationJobs.$inferSelect;
export type FeedbackVoteRow = typeof feedbackVotes.$inferSelect;
export type QualitativeRating = typeof qualitativeRatings.$inferSelect;
export type SplitAssignment = typeof splitAssignments.$inferSelect;
