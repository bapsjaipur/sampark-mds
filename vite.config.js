import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PHASE 43 — LOAD SPEED. Two problems this config fixes:
//
//   1. Everything landed in ONE ~2.6 MB chunk. The heavy libraries (the Firebase
//      SDK, jsPDF + html2canvas, xlsx) shared a bundle with the app code, so any
//      one-character change to a page invalidated the whole thing and every user
//      re-downloaded Firebase to read a bug fix. manualChunks() below pins each
//      big dependency to its own file, which the browser caches across deploys
//      and reuses across routes.
//
//   2. jsPDF/html2canvas/xlsx were pulled into the initial load even though only
//      a couple of admin screens ever export a PDF or a spreadsheet. Splitting
//      them out means they download the first time someone actually exports,
//      not on the calling karyekarta's first paint.
//
// Route-level splitting (React.lazy per page) lives in src/App.jsx; this handles
// the third-party half. Keep react + react-dom + react-router in ONE chunk so
// there is a single React instance and no cross-chunk init-order surprise.
export default defineConfig({
  plugins: [react()],
  build: {
    // A little over the largest expected vendor chunk (Firebase), so the warning
    // only fires on a genuine regression, not on the framework we can't shrink.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Firestore drags in @grpc + protobufjs; keep the whole SDK together.
          if (id.includes('firebase') || id.includes('@firebase') || id.includes('@grpc') || id.includes('protobufjs')) return 'vendor-firebase';
          // PDF/screenshot stack — only loaded when a report is exported.
          if (id.includes('jspdf') || id.includes('html2canvas') || id.includes('dompurify') || id.includes('canvg')) return 'vendor-pdf';
          if (id.includes('xlsx')) return 'vendor-xlsx';
          if (id.includes('lucide-react')) return 'vendor-icons';
          // react / react-dom / react-router / scheduler — one shared instance.
          if (id.includes('/react') || id.includes('scheduler') || id.includes('@remix-run')) return 'vendor-react';
          return 'vendor';
        },
      },
    },
  },
});
