"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  buildArchive,
  listArchives,
  removeArchive,
  upsertArchive,
  type ArchiveEntry,
} from "@/lib/archive";
import type { Candidate, LlmAssessment } from "@/lib/types";

type ArchiveContextValue = {
  archives: ArchiveEntry[];
  saveArchive: (
    profileId: string,
    candidate: Candidate,
    llm?: LlmAssessment | null,
  ) => void;
  openArchive: (id: string) => void;
  removeArchive: (id: string) => void;
  pendingId: string | null;
  clearPending: () => void;
};

const ArchiveContext = createContext<ArchiveContextValue>({
  archives: [],
  saveArchive: () => {},
  openArchive: () => {},
  removeArchive: () => {},
  pendingId: null,
  clearPending: () => {},
});

/** 档案库数据源：localStorage 持久化 + 跨页打开已存档简历。 */
export function ArchiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    setArchives(listArchives());
  }, []);

  const saveArchive = useCallback(
    (
      profileId: string,
      candidate: Candidate,
      llm?: LlmAssessment | null,
    ) => {
      setArchives(upsertArchive(buildArchive(profileId, candidate, llm)));
    },
    [],
  );

  const openArchive = useCallback(
    (id: string) => {
      setPendingId(id);
      router.push("/");
    },
    [router],
  );

  const handleRemove = useCallback((id: string) => {
    setArchives(removeArchive(id));
  }, []);

  const clearPending = useCallback(() => setPendingId(null), []);

  const value = useMemo(
    () => ({
      archives,
      saveArchive,
      openArchive,
      removeArchive: handleRemove,
      pendingId,
      clearPending,
    }),
    [archives, saveArchive, openArchive, handleRemove, pendingId, clearPending],
  );

  return (
    <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>
  );
}

export function useArchive() {
  return useContext(ArchiveContext);
}
