"use client";

import { Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { OpportunityDetail, StageDto } from "../contracts/types";
import { FormLoading } from "./form-loading";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadOpportunityFormOptionsAction } from "./option-actions";

/**
 * The opportunity page's Edit button and its slide-over. The form and its owner,
 * company and contact lists load the first time the slide-over opens, keeping
 * them out of the page's first load. Stages are already on the page for the stage
 * tracker, so they are passed in. The new-opportunity page, where the form is the
 * content, imports the form directly.
 */

const OpportunityForm = dynamic(
  () => import("./opportunity-form").then((loaded) => loaded.OpportunityForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function EditOpportunityButton({
  opportunity,
  stages,
  currentUserId,
}: {
  opportunity: OpportunityDetail;
  stages: StageDto[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const options = useLazyOptions(loadOpportunityFormOptionsAction, open);

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
        <OptionsGate state={options}>
          {(loaded) => (
            <OpportunityForm
              key={formKey}
              opportunity={opportunity}
              options={{ ...loaded, stages }}
              currentUserId={currentUserId}
              onSaved={() => setOpen(false)}
              onCancel={() => setOpen(false)}
            />
          )}
        </OptionsGate>
      </Dialog>
    </>
  );
}
