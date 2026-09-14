"use client";

import { Pencil, Plus } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { ContactDetail } from "../contracts/types";
import { FormLoading } from "./form-loading";

/**
 * Create or edit a contact, in a slide-over. The form loads the first time the
 * slide-over opens, keeping its schema out of the page's first load.
 */

const ContactForm = dynamic(
  () => import("./contact-form-body").then((loaded) => loaded.ContactForm),
  { ssr: false, loading: () => <FormLoading /> },
);

export function ContactFormButton({
  contact,
  accounts,
  owners,
  currentUserId,
  defaultAccountId,
  variant,
}: {
  contact?: ContactDetail;
  accounts: { id: string; name: string }[];
  owners: { id: string; name: string }[];
  currentUserId: string;
  defaultAccountId?: string;
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
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
        <ContactForm
          key={formKey}
          contact={contact}
          accounts={accounts}
          owners={owners}
          currentUserId={currentUserId}
          defaultAccountId={defaultAccountId}
          onDone={() => setOpen(false)}
        />
      </Dialog>
    </>
  );
}
