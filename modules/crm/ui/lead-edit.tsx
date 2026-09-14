"use client";

import { Pencil } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { LeadDetail } from "../contracts/types";
import { FormLoading } from "./form-loading";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadOwnerOptionsAction } from "./option-actions";

/**
 * The lead page's Edit button and its slide-over. The form and its owner list
 * both load the first time the slide-over opens, keeping them out of the page's
 * first load.
 */

const LeadEditForm = dynamic(
  () => import("./lead-edit-form").then((loaded) => loaded.LeadEditForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function LeadEditButton({ lead }: { lead: LeadDetail }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const options = useLazyOptions(loadOwnerOptionsAction, open);

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
        <OptionsGate state={options}>
          {({ owners }) => (
            <LeadEditForm
              key={formKey}
              lead={lead}
              owners={owners}
              onDone={() => setOpen(false)}
            />
          )}
        </OptionsGate>
      </Dialog>
    </>
  );
}
