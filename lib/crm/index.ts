import { HighLevelCrm } from "./highlevel";
import type { CrmClient } from "./types";

/**
 * One agency-level token serves every clinic; per-clinic location and calendar
 * ids live on the clinic row. Without a token the app runs in local mode and
 * CRM jobs are skipped.
 */
export function getCrm(): CrmClient | null {
  const token = process.env.GHL_API_TOKEN;
  if (!token) return null;
  return new HighLevelCrm(token, process.env.GHL_BASE_URL || undefined);
}

export function crmMode(): "highlevel" | "local" {
  return getCrm() ? "highlevel" : "local";
}
