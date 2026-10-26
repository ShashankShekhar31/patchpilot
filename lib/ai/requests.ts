import { z } from "zod";
import { CATEGORIES } from "./schema";
import { SEVERITIES } from "@/lib/severity";

const HARD_MAX_INPUT = 120_000;

export const FocusSchema = z.enum(["all", "security", "bugs", "tests", "maintainability"]);

const codeField = z
  .string()
  .min(10, "Paste at least 10 characters of code or a diff.")
  .max(HARD_MAX_INPUT, `Input is limited to ${HARD_MAX_INPUT} characters.`)
  .refine((value) => value.trim().length >= 10, "Input cannot be only whitespace.");

export const ReviewRequestSchema = z
  .object({
    code: codeField,
    filename: z.string().trim().max(200).optional(),
    language: z.string().trim().max(40).optional(),
    focus: FocusSchema.optional(),
  })
  .strict();

export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;

export const ContextFindingSchema = z
  .object({
    title: z.string().trim().min(3).max(200),
    severity: z.enum(SEVERITIES),
    category: z.enum(CATEGORIES).optional(),
    file: z.string().trim().max(300).nullable().optional(),
    lineStart: z.number().int().positive().nullable().optional(),
    explanation: z.string().trim().max(1500).optional(),
    fix: z.string().trim().max(1500).optional(),
    evidence: z.string().trim().max(2000).optional(),
  })
  .strict();

export type ContextFinding = z.infer<typeof ContextFindingSchema>;

export const AskRequestSchema = z
  .object({
    code: codeField,
    question: z.string().trim().min(3, "Ask a question.").max(1_000),
    findings: z.array(ContextFindingSchema).max(12).default([]),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(1_500),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();

export type AskRequest = z.infer<typeof AskRequestSchema>;

export const TestsRequestSchema = z
  .object({
    code: codeField,
    framework: z.string().trim().max(40).optional(),
    language: z.string().trim().max(40).optional(),
    findings: z.array(ContextFindingSchema).max(12).default([]),
  })
  .strict();

export type TestsRequest = z.infer<typeof TestsRequestSchema>;

export const McpReviewRequestSchema = z
  .object({
    code: codeField,
    filename: z.string().trim().max(200).optional(),
    language: z.string().trim().max(40).optional(),
    focus: FocusSchema.optional(),
  })
  .strict();

export const McpTestsRequestSchema = z
  .object({
    code: codeField,
    framework: z.string().trim().max(40).optional(),
    language: z.string().trim().max(40).optional(),
  })
  .strict();

export const McpAskRequestSchema = z
  .object({
    code: codeField,
    question: z.string().trim().min(3).max(1_000),
  })
  .strict();