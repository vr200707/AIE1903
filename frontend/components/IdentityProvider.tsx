"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Identity = { name: string; detail: string };

const IdentityContext = createContext<{
  identity: Identity | null;
  setIdentity: (i: Identity | null) => void;
}>({ identity: null, setIdentity: () => {} });

/** 侧栏底部身份位的数据源：由档案页在拿到候选人后写入 */
export function IdentityProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const value = useMemo(() => ({ identity, setIdentity }), [identity]);
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity() {
  return useContext(IdentityContext);
}