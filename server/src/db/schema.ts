import { sqliteTable, integer, text, booleanFromInteger } from "drizzle-orm/sqlite-core";
import { defineRelations, sql } from "drizzle-orm";
export * from "./auth-schema"
import { user } from "./auth-schema"
export const exams = sqliteTable("exams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id").notNull().references(() => user.id),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  status: text("status", {
    enum: ["enabled", "disabled"],
  }).notNull()
    .default("enabled"),
  expired: integer("expired", { mode: "boolean" })
    .notNull()
    .default(false),
});

export const examLog = sqliteTable("exam_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // name of the person not the exam, that'd be redundant
  code: text("code").notNull(),
  ip: text("ip").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }) //
    .notNull()
    .default(sql`(unixepoch())`),
  expired: integer("expired", { mode: "boolean" })
    .notNull()
    .default(false),
})
export const Relations = defineRelations({}, (r) => ({

}));
