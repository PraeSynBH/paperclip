/**
 * Background job type constants.
 *
 * These are used as the `jobType` discriminator in the background_jobs table.
 * Add new job types here when wiring up new async processors.
 */
export const BACKGROUND_JOB_TYPES = {
  /** Search across issues, activity, and documents by keyword */
  RESEARCH_ACTIVITY_SEARCH: "research.activity_search",
  /** Auto-assess research items — summarize, score, and flag items */
  RESEARCH_AUTO_ASSESS: "research.auto_assess",
  /** Semantic upgrade of keyword search results via embedding/reranking */
  RESEARCH_SEMANTIC_SEARCH: "research.semantic_search",
  /** Generate a PDF export of research/trip results */
  EXPORT_PDF: "export.pdf",
  /** Generate an iCalendar (.ics) export of trip dates */
  EXPORT_ICS: "export.ics",
} as const;

export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[keyof typeof BACKGROUND_JOB_TYPES];