// src/components/admin-tools/BackupRestoreTab.jsx
import { useState } from 'react';
import { Download, Upload, AlertTriangle } from 'lucide-react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, uploadBytes, deleteObject } from 'firebase/storage';
import { useAuth } from '../../hooks/usePermissions';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui/Button';
import Modal from '../ui/Modal';
import { Input } from '../ui/Input';

export default function BackupRestoreTab() {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [includePhotos, setIncludePhotos] = useState(true);

  // Restore Modal State
  const [showRestoreModal, setShowRestoreModal] = useState(false);
  const [restoreFile, setRestoreFile] = useState(null);
  const [confirmText, setConfirmText] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');

  // Trigger Backup
  async function handleBackup() {
    if (!hasPermission('manage_users')) {
      showToast({ type: 'error', message: 'Missing permission.' });
      return;
    }

    setBackingUp(true);
    try {
      const functions = getFunctions();
      const backupFn = httpsCallable(functions, 'backupDatabase');
      const { data } = await backupFn({ includePhotos });

      if (data?.downloadUrl) {
        // Trigger download
        const a = document.createElement('a');
        a.href = data.downloadUrl;
        a.target = '_blank';
        showToast({ type: 'success', message: 'Backup ZIP generated. Starting download…' });
        a.click();
      } else {
        throw new Error('No download URL returned');
      }
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: err.message || 'Backup failed.' });
    } finally {
      setBackingUp(false);
    }
  }

  // Handle Restore
  async function handleRestoreSubmit() {
    if (!restoreFile) {
      showToast({ type: 'error', message: 'Please select a backup file to restore.' });
      return;
    }
    if (confirmText !== 'RESTORE') {
      showToast({ type: 'error', message: "Please type 'RESTORE' to confirm." });
      return;
    }

    setRestoring(true);
    setUploadProgress('Uploading backup file to server…');

    let tempFileRef = null;
    try {
      // 1. Upload to temporary storage location
      const storage = getStorage();
      const tempPath = `temp-restore/restore-${Date.now()}.zip`;
      tempFileRef = ref(storage, tempPath);
      await uploadBytes(tempFileRef, restoreFile);

      setUploadProgress('Running restore function (please wait, this can take up to 2-3 minutes)…');

      // 2. Call restore function
      const functions = getFunctions();
      const restoreFn = httpsCallable(functions, 'restoreDatabase');
      const { data } = await restoreFn({ filePath: tempPath });

      if (data?.success) {
        showToast({ type: 'success', message: 'Database and photos successfully restored!' });
        setShowRestoreModal(false);
        setRestoreFile(null);
        setConfirmText('');
      } else {
        throw new Error('Restore finished with errors.');
      }
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: err.message || 'Restore failed.' });
    } finally {
      // Clean up uploaded temp file if it stuck
      if (tempFileRef) {
        deleteObject(tempFileRef).catch(() => {});
      }
      setRestoring(false);
      setUploadProgress('');
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-100 bg-white p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-slate-900">Database Backup</h2>
        <p className="mb-4 text-sm text-slate-500">
          Export all Firestore documents (households, individuals, events, padhramanis, etc.) as a ZIP file. Optionally select whether to include Cloud Storage photos in the backup.
        </p>

        <div className="mb-4">
          <label className="flex items-center gap-2 text-sm text-slate-700 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={includePhotos}
              onChange={(e) => setIncludePhotos(e.target.checked)}
              className="h-4 w-4 rounded accent-orange-600 focus:ring-orange-500"
            />
            Include photos and storage files in Zip
          </label>
        </div>

        <Button variant="accent" onClick={handleBackup} disabled={backingUp}>
          <Download className="h-4 w-4" />
          {backingUp ? 'Generating Backup ZIP…' : 'Backup now'}
        </Button>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm">
        <h2 className="mb-1 text-lg font-semibold text-amber-800">Database Restore</h2>
        <p className="mb-4 text-sm text-amber-700">
          Restore Firestore collections and Cloud Storage photos from a previous ZIP backup. This will permanently overwrite current database records and photos.
        </p>
        <Button variant="danger" onClick={() => setShowRestoreModal(true)}>
          <Upload className="h-4 w-4" />
          Restore database
        </Button>
      </div>

      {/* Restore Modal */}
      <Modal
        open={showRestoreModal}
        onClose={() => !restoring && setShowRestoreModal(false)}
        title="Restore Database from Backup"
        size="md"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-800">CRITICAL WARNING</p>
              <p className="mt-1 text-xs text-red-700 leading-relaxed">
                This operation is <span className="font-bold underline">extremely destructive</span>. It will delete all current volunteers, roles, households, contacts, activity logs, photos, events, and restore them to the exact state saved in the backup file. Any changes made since the backup was taken will be permanently lost.
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Select Backup .zip file
            </label>
            <input
              type="file"
              accept=".zip"
              disabled={restoring}
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500">
              Confirm action
            </label>
            <p className="text-xs text-slate-400">
              Type <strong className="text-red-600 font-bold">RESTORE</strong> in the field below to confirm you want to proceed.
            </p>
            <Input
              value={confirmText}
              disabled={restoring}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type RESTORE to confirm"
              className="mt-1.5"
            />
          </div>

          {restoring && (
            <div className="rounded-lg bg-orange-50 p-3 text-center text-xs font-medium text-orange-800 animate-pulse">
              {uploadProgress}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <Button variant="ghost" onClick={() => setShowRestoreModal(false)} disabled={restoring}>
              Cancel
            </Button>
            <Button
              variant="dangerSolid"
              onClick={handleRestoreSubmit}
              disabled={restoring || !restoreFile || confirmText !== 'RESTORE'}
            >
              {restoring ? 'Restoring…' : 'Start Restore'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
