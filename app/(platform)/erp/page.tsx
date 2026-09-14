import { redirect } from "next/navigation";

/** ERP Phase 1 is finance only; its landing page is the finance dashboard. */
export default function ErpPage() {
  redirect("/erp/finance");
}
