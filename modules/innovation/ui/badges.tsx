import { Badge, type BadgeTone } from "@/components/ui/primitives";
import {
  IDEA_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  type IdeaStatus,
  type ProjectStatus,
} from "../contracts/types";

const IDEA_TONES: Record<IdeaStatus, BadgeTone> = {
  NEW: "info",
  REVIEWING: "warning",
  APPROVED: "success",
  IN_PROGRESS: "info",
  IMPLEMENTED: "success",
  REJECTED: "neutral",
};

const PROJECT_TONES: Record<ProjectStatus, BadgeTone> = {
  PLANNING: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
};

export function IdeaStatusBadge({ status }: { status: IdeaStatus }) {
  return <Badge tone={IDEA_TONES[status]}>{IDEA_STATUS_LABELS[status]}</Badge>;
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return <Badge tone={PROJECT_TONES[status]}>{PROJECT_STATUS_LABELS[status]}</Badge>;
}
