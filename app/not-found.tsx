import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-[#121212] text-gray-900 dark:text-white">
      <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-[#D4AF37]/30 flex items-center justify-center text-[#D4AF37] font-black text-2xl mb-4">
        404
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white mb-2">
        Page Not Found
      </h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md mb-6">
        The requested page or resource could not be found. Please check the URL or return to the Solarithm Insight dashboard.
      </p>
      <Link
        href="/"
        className="px-5 py-2.5 rounded-xl bg-[#D4AF37] hover:bg-[#e6be40] text-black font-bold text-xs shadow-md transition-colors"
      >
        Return to Dashboard
      </Link>
    </div>
  );
}
