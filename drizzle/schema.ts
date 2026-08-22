import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

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

export const signerCaptures = mysqlTable(
  "signer_captures",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    signerId: int("signerId").notNull(),
    status: mysqlEnum("status", ["accepted", "uploaded", "failed"]).default("accepted").notNull(),
    mimeType: varchar("mimeType", { length: 128 }).notNull(),
    uploadKey: varchar("uploadKey", { length: 512 }).notNull().unique(),
    clientRecordedAt: timestamp("clientRecordedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("signer_capture_signer_id_idx").on(table.signerId)],
);

export type SignerAccount = typeof signerAccounts.$inferSelect;
export type SignerInvitation = typeof signerInvitations.$inferSelect;
export type SignerSession = typeof signerSessions.$inferSelect;
