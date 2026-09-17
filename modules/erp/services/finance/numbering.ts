import { BusinessRuleError } from "@/lib/errors";
import type { PrismaTransaction } from "@/lib/prisma";
import {
  FINANCE_DOCUMENT_TYPE_LABELS,
  type FinanceDocumentType,
} from "../../contracts/types";
import { formatDocumentNumber } from "../../domain/ar";
import { yearOfIsoDate } from "../../domain/journal";

/**
 * Document numbers from configured series (ADR-023, ADR-033). The format — prefix,
 * padding, yearly reset — is data in `erp.number_series`, changed in AR or AP
 * settings, never code.
 *
 * Taken inside the posting transaction under a row lock: numbers are unique and
 * sequential, and a posting that rolls back consumes nothing.
 */
export async function nextDocumentNumber(
  tx: PrismaTransaction,
  documentType: FinanceDocumentType,
  documentDate: string,
): Promise<string> {
  const series = (
    await tx.$queryRaw<
      { id: string; prefix: string; padding: number; resets_yearly: boolean }[]
    >`
      SELECT id, prefix, padding, resets_yearly
        FROM erp.number_series
       WHERE document_type = ${documentType}
         FOR UPDATE`
  )[0];
  if (series === undefined) {
    throw new BusinessRuleError(
      `Numbering for ${FINANCE_DOCUMENT_TYPE_LABELS[documentType].toLowerCase()} is not configured. Set it up in ${documentType.startsWith("AP_") ? "AP" : "AR"} settings.`,
    );
  }

  const year = series.resets_yearly ? yearOfIsoDate(documentDate) : 0;
  const counter = (
    await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO erp.number_series_counters (series_id, year, last_number, updated_at)
      VALUES (${series.id}::uuid, ${year}, 1, now())
      ON CONFLICT (series_id, year) DO UPDATE
        SET last_number = erp.number_series_counters.last_number + 1, updated_at = now()
      RETURNING last_number`
  )[0];
  if (counter === undefined) throw new Error("Document number counter returned no row.");

  return formatDocumentNumber(
    series.prefix,
    series.resets_yearly ? year : null,
    series.padding,
    counter.last_number,
  );
}
