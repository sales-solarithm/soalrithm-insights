import type {Metadata} from 'next';
import './globals.css';
import { OwnerAuthProvider } from '@/src/context/OwnerAuthContext';

export const metadata: Metadata = {
  title: 'Solarithm Insight',
  description: 'Executive Project & Financial Management Console',
  openGraph: {
    title: 'Solarithm Insight',
    description: 'Executive Project & Financial Management Console',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body className="bg-[#121212] text-white min-h-screen font-sans antialiased" suppressHydrationWarning>
        <OwnerAuthProvider>
          {children}
        </OwnerAuthProvider>
      </body>
    </html>
  );
}

