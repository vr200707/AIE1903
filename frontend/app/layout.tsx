import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import { IdentityProvider } from "@/components/IdentityProvider";
import { ArchiveProvider } from "@/components/ArchiveProvider";

export const metadata: Metadata = {
  title: "Candidate Profile Analysis",
  description: "AI-assisted faculty hiring workflow with evidence-grounded candidate profiles",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="relative min-h-full">
        <ArchiveProvider>
          <IdentityProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="min-w-0 flex-1">{children}</div>
            </div>
          </IdentityProvider>
        </ArchiveProvider>
      </body>
    </html>
  );
}
