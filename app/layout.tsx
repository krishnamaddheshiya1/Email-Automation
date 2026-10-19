import type { Metadata } from "next";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { siteConfig } from "@/lib/config/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: siteConfig.name,
  description: siteConfig.description,
};

import { MailWorkspaceProvider } from "@/components/layout/mail-workspace-context";
import { ComposeModal } from "@/components/mail/compose-modal";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <MailWorkspaceProvider>
          <Suspense
            fallback={
              <div className="h-16 border-b border-slate-200 bg-white/80 dark:border-slate-800 dark:bg-slate-900/80" />
            }
          >
            <Header />
          </Suspense>
          <div className="flex-1 flex flex-col">{children}</div>
          <ComposeModal />
          <Footer />
        </MailWorkspaceProvider>
      </body>
    </html>
  );
}
