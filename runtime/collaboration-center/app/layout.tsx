import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "LIVE OPS · 直播运营指挥台",
    description: "直播间备用账号、异常处置与违规监控的运营看板。",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "LIVE OPS · 直播运营指挥台", description: "直播运营风险与违规监控看板。", images: [{ url: image, width: 1920, height: 1080, alt: "LIVE OPS CONTROL" }] },
    twitter: { card: "summary_large_image", title: "LIVE OPS · 直播运营指挥台", description: "直播运营风险与违规监控看板。", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
