import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GitHub Trending Daily | 每日热门项目精选",
  description: "每日自动抓取 GitHub 热门项目，AI 智能总结，安全评分，助你发现最有价值的开源项目",
  openGraph: {
    title: "GitHub Trending Daily",
    description: "每日热门项目精选",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} antialiased`}
      >
        <div className="noise-overlay" />
        {children}
      </body>
    </html>
  );
}
