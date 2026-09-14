"use client";

import { Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { OpportunityDetail } from "../contracts/types";
import { FormLoading } from "./form-loading";
import type { OpportunityFormOptions } from "./opportunity-form";

/**
 * The opportunity page's Edit button and its slide-over. The form loads the first
 * time the slide-over opens, keeping its schema out of the page's first load.
 * The new-opportunity page, where the form is the content, imports it directly.
 */

const OpportunityForm = dynamic(
  () => import("./opportunity-form").then((loaded) => loaded.OpportunityForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function EditOpportunityButton({
  opportunity,
  options,
  currentUserId,
}: {
  opportunity: OpportunityDetail;
  options: OpportunityFormOptions;
  currentUserId: string;
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
      <Dialog open={open} onOpenChange={setOpen} title="Edit opportunity" variant="sheet">
        <OpportunityForm
          key={formKey}
          opportunity={opportunity}
          options={options}
          currentUserId={currentUserId}
          onSaved={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
