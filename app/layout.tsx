import type { Metadata } from 'next';
import './globals.css';
import { OwnerAuthProvider } from '@/src/context/OwnerAuthContext';
import { ThemeProvider } from '@/src/context/ThemeContext';
import OwnerAuthGuard from '@/src/components/OwnerAuthGuard';

export const metadata: Metadata = {
  title: 'Solarithm Insight',
  description: 'Executive Project & Financial Management Console',
  openGraph: {
    title: 'Solarithm Insight',
    description: 'Executive Project & Financial Management Console',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Solarithm Insight',
    description: 'Executive Project & Financial Management Console',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        {/* Anti-Hydration Flash Script: Sets initial dark class immediately before render */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var saved = localStorage.getItem('solarithm_theme_mode') || localStorage.getItem('solarithm_theme');
                  if (saved === 'light') {
                    document.documentElement.classList.remove('dark');
                    document.documentElement.classList.add('light');
                  } else {
                    document.documentElement.classList.add('dark');
                    document.documentElement.classList.remove('light');
                  }
                } catch (e) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className="bg-white text-gray-900 dark:bg-[#121212] dark:text-white min-h-screen font-sans antialiased transition-colors"
        suppressHydrationWarning
      >
        <ThemeProvider>
          <OwnerAuthProvider>
            <OwnerAuthGuard>{children}</OwnerAuthGuard>
          </OwnerAuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
