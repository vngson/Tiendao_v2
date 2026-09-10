import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tiên đạo — Đọc truyện Trung Việt",
  description:
    "Tiên đạo — trang đọc truyện Trung Quốc dịch sang tiếng Việt, phong cách tối giản.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
