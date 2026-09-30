import type {Metadata} from 'next';
import './globals.css';
import { OwnerAuthProvider } from '@/src/context/OwnerAuthContext';
import { ThemeProvider } from '@/src/context/ThemeContext';

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
      <body className="bg-white text-gray-900 dark:bg-[#121212] dark:text-white min-h-screen font-sans antialiased transition-colors" suppressHydrationWarning>
        <ThemeProvider>
          <OwnerAuthProvider>
            {children}
          </OwnerAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

