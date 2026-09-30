import type { EvidenceStatus } from "@/lib/types";
import { evidenceStatusLabel } from "@/lib/labels";

const COLOR: Record<EvidenceStatus, string> = {
  confirmed: "border-emerald-400/20 bg-emerald-500/15 text-emerald-300",
  not_found_public: "border-amber-400/20 bg-amber-500/15 text-amber-300",
  to_verify: "border-sky-400/20 bg-sky-500/15 text-sky-300",
  conflict: "border-rose-400/20 bg-rose-500/15 text-rose-300",
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
