import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "候选人档案分析系统",
  description: "AI 辅助高校教师招聘系统 - 候选人档案智能分析",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full">
        {/* 背景装饰光球（轻量 CSS 版，替代 3D 球体） */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div
            className="absolute -top-24 -left-24 h-96 w-96 rounded-full bg-white/5 blur-3xl"
            style={{ animation: "float-slow 12s ease-in-out infinite" }}
          />
          <div
            className="absolute top-1/3 -right-24 h-80 w-80 rounded-full bg-white/5 blur-3xl"
            style={{ animation: "float-slower 15s ease-in-out infinite" }}
          />
          <div
            className="absolute -bottom-24 left-1/4 h-72 w-72 rounded-full bg-white/5 blur-3xl"
            style={{ animation: "drift 18s ease-in-out infinite" }}
          />
        </div>
        {children}
      </body>
    </html>
  );
}
