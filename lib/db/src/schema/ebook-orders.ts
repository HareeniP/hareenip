import { createInsertSchema } from "drizzle-zod";
import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { booksTable } from "./books";

export const ebookOrdersTable = pgTable("ebook_orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  bookId: uuid("book_id").references(() => booksTable.id, {
    onDelete: "set null",
  }),
  razorpayOrderId: text("razorpay_order_id").notNull().unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("created"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export const insertEbookOrderSchema = createInsertSchema(ebookOrdersTable).omit({
  id: true,
  createdAt: true,
  verifiedAt: true,
});

export type InsertEbookOrder = z.infer<typeof insertEbookOrderSchema>;
export type EbookOrder = typeof ebookOrdersTable.$inferSelect;
