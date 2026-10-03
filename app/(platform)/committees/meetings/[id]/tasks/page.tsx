import { redirect } from "next/navigation";

/** The breadcrumb above a task links here: the meeting's Team To-Do List. */
export default async function MeetingTasksPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/committees/meetings/${encodeURIComponent(id)}?tab=todo`);
}
