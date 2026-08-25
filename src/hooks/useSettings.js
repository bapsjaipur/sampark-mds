// src/hooks/useSettings.js
// Live subscription to a settings document, defaults already merged in.
//
// Note the deliberate error handling: a settings read failure must NOT break the
// screen that depends on it. The calling flow needs settings/messageTemplate,
// and a volunteer whose role can't read it (or an offline device) should still
// get a working WhatsApp button using the built-in default template. So the
// hook resolves to defaults on error and exposes `error` for optional display.
//
// `readDenied` is the useful diagnostic for the admin screens. Reading a
// settings doc requires no permission at all — only a volunteers/{uid} record
// (see `match /settings/{docId}` in firestore.rules). So a permission-denied on
// READ cannot be a role problem: it means the live ruleset has no match for the
// path, i.e. firestore.rules has not been deployed since Phase 20 added the
// collection. That distinction is what tells an admin whether to deploy rules
// or to tick a permission, and guessing wrong wastes a lot of time.
import { useEffect, useState } from 'react';
import { subscribeToSettings } from '../services/settingsService';

export function useSettings(docId) {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    const unsub = subscribeToSettings(docId, (data, err) => {
      setSettings(data);
      setError(err ? err.message : null);
      setErrorCode(err ? (err.code || null) : null);
      setLoading(false);
    });
    return () => unsub();
  }, [docId]);

  return { settings, loading, error, errorCode, readDenied: errorCode === 'permission-denied' };
}

export default useSettings;
