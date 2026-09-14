"use client";

import { Pencil, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { AccountDetail } from "../contracts/types";
import { FormLoading } from "./form-loading";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadOwnerOptionsAction } from "./option-actions";

/**
 * Create or edit a company, in a slide-over. The form and its owner list load the
 * first time the slide-over opens, keeping them out of the page's first load.
 */

const AccountForm = dynamic(
  () => import("./account-form-body").then((loaded) => loaded.AccountForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function AccountFormButton({
  account,
  currentUserId,
}: {
  account?: AccountDetail;
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const options = useLazyOptions(loadOwnerOptionsAction, open);
  const isEdit = account !== undefined;

  return (
    <>
      <Button
        variant={isEdit ? "secondary" : "primary"}
        icon={
          isEdit ? (
            <Pencil aria-hidden="true" size={14} />
          ) : (
            <Plus aria-hidden="true" size={15} />
          )
        }
        onClick={() => {
          setFormKey((key) => key + 1);
          setOpen(true);
        }}
      >
        {isEdit ? "Edit" : "New company"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={isEdit ? "Edit company" : "New company"}
        variant="sheet"
      >
        <OptionsGate state={options}>
          {({ owners }) => (
            <AccountForm
              key={formKey}
              account={account}
              owners={owners}
              currentUserId={currentUserId}
              onDone={() => setOpen(false)}
            />
          )}
        </OptionsGate>
      </Dialog>
    </>
  );
}
