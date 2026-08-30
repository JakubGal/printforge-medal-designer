import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PrintForge — Parametric product studios',
  description: 'Choose a focused workspace and customize a production-ready 3D printable product without learning CAD.',
  openGraph: {
    title: 'PrintForge',
    description: 'Product-specific 3D customization without the blank CAD screen.',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'MedalForge multicolor printable medal designer' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PrintForge',
    description: 'Product-specific 3D customization without the blank CAD screen.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
