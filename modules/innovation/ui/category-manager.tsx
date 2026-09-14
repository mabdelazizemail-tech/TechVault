"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form-controls";
import { Panel, PanelHeader } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import type { CategoryDto, CategoryKind } from "../contracts/types";
import { createCategoryAction, updateCategoryAction } from "./actions";

/** Add, rename and archive categories. Archived ones stay on existing items. */
export function CategoryManager({
  kind,
  title,
  categories,
}: {
  kind: CategoryKind;
  title: string;
  categories: CategoryDto[];
}) {
  const notify = useToast();
  const [name, setName] = useState("");
  const [isPending, startTransition] = useTransition();

  return (
    <Panel className="overflow-hidden">
      <PanelHeader title={title} />
      <ul className="divide-border divide-y">
        {categories.map((category) => (
          <CategoryRow key={category.id} category={category} />
        ))}
      </ul>
      <form
        className="border-border flex items-center gap-2 border-t px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createCategoryAction({ kind, name });
            if (result.ok) {
              setName("");
              notify("Category added.");
            } else notify(result.fieldErrors?.name?.[0] ?? result.message, "error");
          });
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New category"
          aria-label={`New ${title.toLowerCase()} name`}
          maxLength={60}
          dir="auto"
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          isPending={isPending}
          disabled={name.trim() === ""}
        >
          Add
        </Button>
      </form>
    </Panel>
  );
}

function CategoryRow({ category }: { category: CategoryDto }) {
  const notify = useToast();
  const [name, setName] = useState(category.name);
  const [isPending, startTransition] = useTransition();

  const save = (next: { name: string; isActive: boolean }) =>
    startTransition(async () => {
      const result = await updateCategoryAction(category.id, next);
      if (!result.ok) {
        setName(category.name);
        notify(result.fieldErrors?.name?.[0] ?? result.message, "error");
      }
    });

  return (
    <li className="flex items-center gap-2 px-4 py-2">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          if (name.trim() !== "" && name !== category.name) {
            save({ name, isActive: category.isActive });
          }
        }}
        aria-label={`Rename ${category.name}`}
        maxLength={60}
        disabled={isPending}
        dir="auto"
        className={category.isActive ? undefined : "text-foreground-subtle line-through"}
      />
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => save({ name: category.name, isActive: !category.isActive })}
      >
        {category.isActive ? "Archive" : "Restore"}
      </Button>
    </li>
  );
}
