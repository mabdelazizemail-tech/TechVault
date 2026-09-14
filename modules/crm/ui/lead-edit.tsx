"use client";

import { Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { LeadDetail } from "../contracts/types";
import { FormLoading } from "./form-loading";

/**
 * The lead page's Edit button and its slide-over. The form itself loads the first
 * time the slide-over opens, keeping its schema out of the page's first load.
 */

const LeadEditForm = dynamic(
  () => import("./lead-edit-form").then((loaded) => loaded.LeadEditForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function LeadEditButton({
  lead,
  owners,
}: {
  lead: LeadDetail;
  owners: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <Button
        icon={<Pencil aria-hidden="true" size={14} />}
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Edit lead" variant="sheet">
        <LeadEditForm
          key={formKey}
          lead={lead}
          owners={owners}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
