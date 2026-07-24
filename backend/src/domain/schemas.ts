import { z } from "zod";
import { isSafeKnowledgeSourceUrl } from "./source-url.js";

export const registerDeviceSchema = z.object({
  installationId: z.string().uuid()
}).strict();

export const createAnalysisJobSchema = z.object({
  candidateToken: z.string().uuid(),
  capturedAtBucket: z.string().date().nullable().default(null),
  localLabels: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  qualityScore: z.number().min(0).max(1),
  sensitiveFlags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  contentType: z.literal("image/jpeg"),
  evaluationContext: z.object({
    datasetId: z.string().regex(/^[A-Za-z0-9._-]{3,128}$/),
    runId: z.string().regex(/^[A-Za-z0-9._-]{3,128}$/),
    labelsSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sampleId: z.string().regex(/^[A-Za-z0-9._-]{3,128}$/)
  }).strict().optional()
}).strict();

export const feedbackSchema = z.object({
  action: z.enum(["LIKE", "DISLIKE", "WRONG_OBJECT", "TOO_PRIVATE", "SAVE"])
}).strict();

export const trackItemSchema = z.object({
  startedOn: z.string().date(),
  reminderDays: z.number().int().min(7).max(730)
}).strict();

export const idParamSchema = z.object({
  id: z.string().uuid()
}).strict();

export const cardIdParamSchema = z.object({
  cardId: z.string().uuid()
}).strict();

export const cardsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
}).strict();

export const detectedEntitySchema = z.object({
  canonicalTopicId: z.string().min(1).max(100),
  displayName: z.string().min(1).max(60),
  confidence: z.number().min(0).max(1),
  boundingBox: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().min(0).max(1),
    height: z.number().min(0).max(1)
  }).strict().nullable(),
  alternatives: z.array(z.string().min(1).max(60)).max(5),
  sensitiveFlags: z.array(z.enum([
    "face",
    "selfie",
    "identity_document",
    "bank_card",
    "receipt",
    "document",
    "high_text_density",
    "screenshot"
  ])).max(8)
}).strict();

export const cardDraftSchema = z.object({
  title: z.string().min(2).max(30),
  factId: z.string().min(1).max(100),
  sourceIds: z.array(z.string().min(1).max(100)).min(1).max(3)
    .refine((ids) => new Set(ids).size === ids.length, "sourceIds must be unique")
}).strict();

const sourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().max(2_048)
    .refine(isSafeKnowledgeSourceUrl, "source URL must be a public HTTPS web URL"),
  publisher: z.string().trim().min(1).max(120),
  authority: z.enum(["reference", "official", "professional"])
}).strict();

const factSchema = z.object({
  factId: z.string().min(1),
  topicId: z.string().min(1),
  factText: z.string().min(20).max(240),
  sourceIds: z.array(z.string().min(1)).min(1)
    .refine((ids) => new Set(ids).size === ids.length, "sourceIds must be unique"),
  riskLevel: z.enum(["general", "health", "safety"]),
  reviewStatus: z.enum(["approved", "draft", "rejected"]),
  review: z.object({
    reviewerId: z.string().trim().min(3).max(100),
    reviewedAt: z.string().datetime(),
    sourceCheckedAt: z.string().datetime(),
    notes: z.string().trim().max(500).optional()
  }).strict().optional()
}).strict();

export const knowledgeCatalogSchema = z.object({
  version: z.string().min(1),
  sources: z.array(sourceSchema).min(1),
  topics: z.array(z.object({
    topicId: z.string().min(1),
    displayName: z.string().trim().min(1).max(60),
    synonyms: z.array(z.string().min(1)).min(1),
    category: z.enum(["home", "tableware", "cleaning", "tool", "digital", "transport"]),
    facts: z.array(factSchema).min(1)
  }).strict()).min(1)
}).strict();
