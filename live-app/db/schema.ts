import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const paperAccounts = sqliteTable("paper_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  initialCash: integer("initial_cash").notNull(),
  version: integer("version").notNull().default(0),
  stateJson: text("state_json").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const paperHistory = sqliteTable("paper_history", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  mode: text("mode").notNull(),
  date: text("date").notNull(),
  value: integer("value").notNull(),
  invested: integer("invested").notNull(),
});

export const paperCandles = sqliteTable("paper_candles", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull(),
  symbol: text("symbol").notNull(),
  date: text("date").notNull(),
  close: integer("close").notNull(),
});
