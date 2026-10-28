"use client";

import {
  createContext,
  startTransition,
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
  clearArchives,
  listArchives,
  removeArchive,
  updateArchiveInterviewScore,
  upsertArchive,
  type ArchiveEntry,
  type InterviewScoreRecord,
} from "@/lib/archive";
import type { Candidate, LlmAssessment } from "@/lib/types";

type ArchiveContextValue = {
  archives: ArchiveEntry[];
  saveArchive: (
    profileId: string,
    candidate: Candidate,
    llm?: LlmAssessment | null,
  ) => void;
  saveInterviewScore: (profileId: string, record: InterviewScoreRecord) => void;
  openArchive: (id: string) => void;
  openInterviewOverview: (id: string) => void;
  removeArchive: (id: string) => void;
  clearArchives: () => void;
  pendingId: string | null;
  clearPending: () => void;
  pendingInterviewId: string | null;
  clearPendingInterview: () => void;
};

const ArchiveContext = createContext<ArchiveContextValue>({
  archives: [],
  saveArchive: () => {},
  saveInterviewScore: () => {},
  openArchive: () => {},
  openInterviewOverview: () => {},
  removeArchive: () => {},
  clearArchives: () => {},
  pendingId: null,
  clearPending: () => {},
  pendingInterviewId: null,
  clearPendingInterview: () => {},
});

/** 档案库数据源：localStorage 持久化 + 跨页打开已存档简历。 */
export function ArchiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [archives, setArchives] = useState<ArchiveEntry[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingInterviewId, setPendingInterviewId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const syncArchives = () => {
      startTransition(() => setArchives(listArchives()));
    };
    syncArchives();
    window.addEventListener("storage", syncArchives);
    return () => window.removeEventListener("storage", syncArchives);
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

  const saveInterviewScore = useCallback(
    (profileId: string, record: InterviewScoreRecord) => {
      setArchives(updateArchiveInterviewScore(profileId, record));
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

  const openInterviewOverview = useCallback(
    (id: string) => {
      setPendingInterviewId(id);
      router.push("/");
    },
    [router],
  );

  const handleRemove = useCallback((id: string) => {
    setArchives(removeArchive(id));
  }, []);

  const handleClear = useCallback(() => {
    clearArchives();
    setArchives([]);
  }, []);

  const clearPending = useCallback(() => setPendingId(null), []);

  const clearPendingInterview = useCallback(
    () => setPendingInterviewId(null),
    [],
  );

  const value = useMemo(
    () => ({
      archives,
      saveArchive,
      saveInterviewScore,
      openArchive,
      openInterviewOverview,
      removeArchive: handleRemove,
      clearArchives: handleClear,
      pendingId,
      clearPending,
      pendingInterviewId,
      clearPendingInterview,
    }),
    [
      archives,
      saveArchive,
      saveInterviewScore,
      openArchive,
      openInterviewOverview,
      handleRemove,
      handleClear,
      pendingId,
      clearPending,
      pendingInterviewId,
      clearPendingInterview,
    ],
  );

  return (
    <ArchiveContext.Provider value={value}>{children}</ArchiveContext.Provider>
  );
}

export function useArchive() {
  return useContext(ArchiveContext);
}
