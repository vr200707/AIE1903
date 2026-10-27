"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { QAResponse } from "@/lib/types";

export interface QaHistoryItem {
  id: string;
  question: string;
  answer: string;
  confidence: string;
}

interface QaHistoryContextValue {
  history: QaHistoryItem[];
  addAnswer: (question: string, res: QAResponse) => void;
  clearHistory: () => void;
}

const QaHistoryContext = createContext<QaHistoryContextValue | null>(null);

export function QaHistoryProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<QaHistoryItem[]>([]);

  const addAnswer = useCallback((question: string, res: QAResponse) => {
    setHistory((prev) => [
      {
        id: `${Date.now()}-${prev.length}`,
        question,
        answer: res.answer,
        confidence: res.confidence,
      },
      ...prev,
    ]);
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  const value = useMemo(
    () => ({ history, addAnswer, clearHistory }),
    [history, addAnswer, clearHistory],
  );

  return (
    <QaHistoryContext.Provider value={value}>
      {children}
    </QaHistoryContext.Provider>
  );
}

export function useQaHistory(): QaHistoryContextValue {
  const ctx = useContext(QaHistoryContext);
  if (!ctx) throw new Error("useQaHistory must be used within QaHistoryProvider");
  return ctx;
}
