"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

type Health = {
  status: string;
  service: string;
  version: string;
};

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Health>("/health/")
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-5xl font-bold mb-8 text-blue-600">GrayPDF</h1>
      <p className="text-gray-500 mb-8">PDF tools coming soon</p>

      {error && (
        <div className="text-red-500 bg-red-50 p-4 rounded">
          Error: {error}
        </div>
      )}

      {health ? (
        <div className="text-green-600 bg-green-50 p-4 rounded">
          <p className="font-bold">Backend connected ✅</p>
          <p>Service: {health.service}</p>
          <p>Version: {health.version}</p>
        </div>
      ) : (
        !error && <p className="text-gray-400">Connecting to backend...</p>
      )}
    </main>
  );
}