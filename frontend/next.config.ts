import type { NextConfig } from "next";

// Where the Django API lives, e.g. https://api.example.com. When it's set, the
// site forwards /api/ (and the admin) to it, so the browser only ever talks to
// one domain and the login cookies stay first-party.
const backend = process.env.BACKEND_URL?.replace(/\/+$/, "");
const adminPath = process.env.BACKEND_ADMIN_PATH?.replace(/^\/+|\/+$/g, "");

const nextConfig: NextConfig = {
  // The Docker image sets NEXT_OUTPUT=standalone to get a small self-contained
  // server. Locally, plain `npm run build` + `npm start` keeps working.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,

  // Django URLs end in "/". Next would otherwise redirect /api/x/ to /api/x,
  // which breaks every POST.
  skipTrailingSlashRedirect: true,

  async rewrites() {
    if (!backend) return [];
    // Every Django route ends in "/"; :path* drops it, so add it back.
    const rules = [
      { source: "/api/:path*", destination: `${backend}/api/:path*/` },
      { source: "/django-static/:path*", destination: `${backend}/django-static/:path*` },
    ];
    if (adminPath) {
      rules.push(
        { source: `/${adminPath}`, destination: `${backend}/${adminPath}/` },
        { source: `/${adminPath}/:path*`, destination: `${backend}/${adminPath}/:path*/` },
      );
    }
    return rules;
  },
};

export default nextConfig;
