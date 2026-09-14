"use client";

import { Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogActions } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import type { CostCentreRef } from "../contracts/types";
import { createCostCentreAction, updateCostCentreAction } from "./actions";
import { FormError, fieldError } from "./form-parts";

export type EditableCostCentre = {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  parentId: string | null;
  isActive: boolean;
};

/** Add a cost centre, or edit one. The code is fixed once it exists. */
export function CostCentreFormButton({
  parents,
  centre,
}: {
  parents: CostCentreRef[];
  centre?: EditableCostCentre;
}) {
  const router = useRouter();
  const notify = useToast();
  const isEdit = centre !== undefined;
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(centre?.code ?? "");
  const [name, setName] = useState(centre?.name ?? "");
  const [nameAr, setNameAr] = useState(centre?.nameAr ?? "");
  const [parentId, setParentId] = useState(centre?.parentId ?? "");
  const [isActive, setIsActive] = useState(centre?.isActive ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]> | undefined>();
  const [isPending, startTransition] = useTransition();

  return (
    <>
      {isEdit ? (
        <Button
          size="sm"
          icon={<Pencil aria-hidden="true" className="size-3.5" />}
          aria-label={`Edit cost centre ${centre.code}`}
          onClick={() => {
            setMessage(null);
            setErrors(undefined);
            setOpen(true);
          }}
        >
          Edit
        </Button>
      ) : (
        <Button
          variant="primary"
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => {
            setMessage(null);
            setErrors(undefined);
            setOpen(true);
          }}
        >
          New cost centre
        </Button>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={isEdit ? `Edit cost centre ${centre.code}` : "New cost centre"}
      >
        {message !== null && <FormError message={message} />}
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            setErrors(undefined);
            startTransition(async () => {
              const result = isEdit
                ? await updateCostCentreAction(centre.id, {
                    name,
                    nameAr,
                    parentId,
                    isActive,
                  })
                : await createCostCentreAction({ code, name, nameAr, parentId });
              if (result.ok) {
                setOpen(false);
                notify(isEdit ? "Cost centre updated." : "Cost centre created.");
                router.refresh();
              } else {
                setMessage(result.message);
                setErrors(result.fieldErrors);
              }
            });
          }}
        >
          {!isEdit && (
            <Field
              label="Code"
              htmlFor="centre-code"
              required
              error={fieldError(errors, "code")}
            >
              <Input
                id="centre-code"
                value={code}
                maxLength={20}
                dir="ltr"
                placeholder="CC-SALES"
                onChange={(event) => setCode(event.target.value)}
              />
            </Field>
          )}
          <Field
            label="Name"
            htmlFor="centre-name"
            required
            error={fieldError(errors, "name")}
          >
            <Input
              id="centre-name"
              value={name}
              maxLength={150}
              dir="auto"
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
          <Field
            label="Arabic name"
            htmlFor="centre-name-ar"
            error={fieldError(errors, "nameAr")}
          >
            <Input
              id="centre-name-ar"
              value={nameAr}
              maxLength={150}
              dir="rtl"
              lang="ar"
              onChange={(event) => setNameAr(event.target.value)}
            />
          </Field>
          <Field
            label="Parent"
            htmlFor="centre-parent"
            error={fieldError(errors, "parentId")}
          >
            <Select
              id="centre-parent"
              value={parentId}
              placeholder="None — a top-level cost centre"
              options={parents
                .filter((parent) => parent.id !== centre?.id)
                .map((parent) => ({
                  value: parent.id,
                  label: `${parent.code} — ${parent.name}`,
                }))}
              onChange={(event) => setParentId(event.target.value)}
            />
          </Field>
          {isEdit && (
            <Checkbox
              label="Active — can be used on new journal lines"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
          )}
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" isPending={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Create cost centre"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </>
  );
}
