import type { EvidenceStatus } from "@/lib/types";
import { evidenceStatusLabel } from "@/lib/labels";

const COLOR: Record<EvidenceStatus, string> = {
  confirmed: "bg-green-100 text-green-700",
  not_found_public: "bg-amber-100 text-amber-700",
  to_verify: "bg-blue-100 text-blue-700",
  conflict: "bg-red-100 text-red-700",
};

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs ${COLOR[status]}`}>
      {evidenceStatusLabel[status]}
    </span>
  );
}
