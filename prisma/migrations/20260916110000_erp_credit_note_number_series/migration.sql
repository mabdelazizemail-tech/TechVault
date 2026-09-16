-- Credit notes are numbered from their own series (ADR-029). The document type CHECK
-- created with accounts receivable listed only invoices and receipts, so `CRN` could
-- not be added until now.
ALTER TABLE "erp"."number_series"
  DROP CONSTRAINT "number_series_document_type",
  ADD CONSTRAINT "number_series_document_type"
    CHECK ("document_type" IN ('AR_INVOICE', 'AR_CREDIT_NOTE', 'AR_RECEIPT'));
