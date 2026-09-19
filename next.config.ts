import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  turbopack: {},
  typescript: {
    ignoreBuildErrors: false,
  },
  // Cloudflare Pages serves this as a static export, so Next's server-side
  // Image Optimization API isn't available -- `unoptimized: true` is
  // required here, otherwise `next build` fails outright with
  // output: 'export' when next/image is used anywhere (SalaryStudio.tsx).
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**', // This allows any path under the hostname
      },
    ],
  },
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    // HMR is disabled in AI Studio via DISABLE_HMR env var.
    // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
