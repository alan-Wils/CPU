import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import type { ReactNode } from "react";
import { AuthProvider } from "../lib/auth";
import { AuthGuard } from "../components/auth-guard";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"]
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"]
});

export const metadata: Metadata = {
  title: "CPU Tracking System",
  description: "Cannabis CPU operations platform"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} lang="en">
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <AuthGuard>{children}</AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}
