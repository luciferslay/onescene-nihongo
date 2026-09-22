import type { Metadata } from 'next';
import './globals.css';
import { SITE_NAME, SITE_TAGLINE } from '@/lib/site';

export const metadata: Metadata = {
  title: `${SITE_NAME}`,
  description: '每天用一个真实场景，自然学会一个日语表达。',
  openGraph: { title: SITE_NAME, description: SITE_TAGLINE },
  twitter: { card: 'summary', title: SITE_NAME, description: SITE_TAGLINE },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
