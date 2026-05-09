import type { Metadata } from "next";
import { Geist, Geist_Mono, Space_Grotesk } from "next/font/google";
import "./globals.css";
import CompanyTimezoneSync from "@/components/CompanyTimezoneSync";
import { PeerNotificationsProvider } from "@/components/PeerNotificationsContext";
import TaskLiveNotificationHost from "@/components/TaskLiveNotificationHost";
import PlatformFooterSlogan from "@/components/PlatformFooterSlogan";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NexBatch",
  description: "NexBatch — cultivation, extraction, packaging, and batch tracking.",
  manifest: "/manifest.json",
  themeColor: "#020617",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <head>
        <meta charSet="utf-8" />
      </head>
      <body className="min-h-full flex flex-col">
        <PeerNotificationsProvider>
          <CompanyTimezoneSync />
          <TaskLiveNotificationHost />
          {children}
          <PlatformFooterSlogan />
        </PeerNotificationsProvider>
      </body>
    </html>
  );
}
