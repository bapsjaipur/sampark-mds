// src/pages/NotFoundPage.jsx
// PHASE 44 — a real 404. App.jsx had no catch-all route, so a mistyped or stale
// URL rendered an empty <Outlet> under the shell — a blank page with no hint
// anything was wrong. This renders inside AppLayout, so the sidebar and tab bar
// stay put and "Go home" lands the person somewhere their role can actually reach.
import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import EmptyState from "../components/ui/EmptyState";

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <EmptyState
        icon={Compass}
        title="Page not found"
        message="The page you’re looking for doesn’t exist, or the link that brought you here is out of date."
        action={
          <Link
            to="/"
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700"
          >
            Go home
          </Link>
        }
      />
    </div>
  );
}
