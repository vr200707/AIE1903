import type { EvidenceStatus } from "@/lib/types";
import { evidenceStatusLabel } from "@/lib/labels";

const COLOR: Record<EvidenceStatus, string> = {
  confirmed: "border-emerald-700/40 bg-emerald-500/15 text-emerald-800",
  not_found_public: "border-amber-700/40 bg-amber-500/15 text-amber-800",
  to_verify: "border-sky-700/40 bg-sky-500/15 text-sky-800",
  conflict: "border-rose-700/40 bg-rose-500/15 text-rose-800",
};

export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-xs ${COLOR[status]}`}
    >
      {evidenceStatusLabel[status]}
    </span>
  );
}
