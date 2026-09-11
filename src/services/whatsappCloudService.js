// src/services/whatsappCloudService.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin client wrappers over the Phase 36 WhatsApp Cloud API callables
// (functions/whatsappCloud.js). No secret ever lives here — the access token is
// server-only; getStatus reports whether one is set, never its value.
// ─────────────────────────────────────────────────────────────────────────────
import { getFunctions, httpsCallable } from 'firebase/functions';

/** Current config state for the admin panel: { configured, enabled, phoneNumberId, apiVersion, tokenSet }. */
export async function getWhatsAppCloudStatus() {
  const fn = httpsCallable(getFunctions(), 'getWhatsAppCloudStatus');
  const res = await fn({});
  return res.data;
}

/**
 * Save config. Pass a blank/omitted accessToken to keep the stored one; pass
 * clearToken:true to wipe it. { enabled, phoneNumberId, apiVersion, accessToken?, clearToken? }
 */
export async function saveWhatsAppCloudConfig(payload) {
  const fn = httpsCallable(getFunctions(), 'saveWhatsAppCloudConfig');
  const res = await fn(payload || {});
  return res.data;
}

/** Send one text message. { to, text } → { ok, id } | { skipped }. */
export async function sendWhatsAppCloudMessage({ to, text }) {
  const fn = httpsCallable(getFunctions(), 'sendWhatsAppCloudMessage');
  const res = await fn({ to, text });
  return res.data;
}
