import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Frontdesk — WhatsApp front desk for clinics",
  description: "AI front desk that answers patients, books appointments and recovers no-shows.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
