"use client";

import { Pencil, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ContactDetail } from "../contracts/types";
import { FormLoading } from "./form-loading";
import { OptionsGate, useLazyOptions } from "./lazy-options";
import { loadContactFormOptionsAction } from "./option-actions";

/**
 * Create or edit a contact, in a slide-over. The form, owner list and company list
 * load the first time the slide-over opens, keeping them out of the page's first
 * load. A company page passes `accounts` to preset the only valid company.
 */

const ContactForm = dynamic(
  () => import("./contact-form-body").then((loaded) => loaded.ContactForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function ContactFormButton({
  contact,
  accounts,
  currentUserId,
  defaultAccountId,
  variant,
}: {
  contact?: ContactDetail;
  accounts?: { id: string; name: string }[];
  currentUserId: string;
  defaultAccountId?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const options = useLazyOptions(loadContactFormOptionsAction, open);
  const isEdit = contact !== undefined;

  return (
    <>
      <Button
        variant={variant ?? (isEdit ? "secondary" : "primary")}
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
        {isEdit ? "Edit" : "New contact"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={isEdit ? "Edit contact" : "New contact"}
        variant="sheet"
      >
        <OptionsGate state={options}>
          {(loaded) => (
            <ContactForm
              key={formKey}
              contact={contact}
              accounts={accounts ?? loaded.accounts}
              owners={loaded.owners}
              currentUserId={currentUserId}
              defaultAccountId={defaultAccountId}
              onDone={() => setOpen(false)}
            />
          )}
        </OptionsGate>
      </Dialog>
    </>
  );
}
