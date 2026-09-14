import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/primitives";
import { INNOVATION_PERMISSIONS } from "@/modules/innovation/contracts/permissions";
import { listCategories } from "@/modules/innovation/contracts/service";
import { CategoryManager } from "@/modules/innovation/ui/category-manager";
import { getActor } from "@/platform/auth/current-user";
import { can } from "@/platform/authz/authz";

export const metadata: Metadata = { title: "Categories" };

/** Administrators maintain idea and knowledge categories. */
export default async function CategoriesPage() {
  const actor = await getActor();
  if (!(await can(actor, INNOVATION_PERMISSIONS.CATEGORY_ADMINISTER))) notFound();

  const [ideaCategories, knowledgeCategories] = await Promise.all([
    listCategories(actor, "IDEA", { includeArchived: true }),
    listCategories(actor, "KNOWLEDGE", { includeArchived: true }),
  ]);

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Rename a category by editing it in place. Archived categories stay on existing items but aren't offered for new ones."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoryManager
          kind="IDEA"
          title="Idea categories"
          categories={ideaCategories}
        />
        <CategoryManager
          kind="KNOWLEDGE"
          title="Knowledge categories"
          categories={knowledgeCategories}
        />
      </div>
    </div>
  );
}
