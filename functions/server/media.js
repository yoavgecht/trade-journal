// Unified media layer (screenshots + Film Room videos).
//
// LOCAL: files live in screenshots/ and videos/ on disk (as before).
// WEB (Firebase Functions): files live in Cloud Storage; the SQLite-backed
// server streams them through the same URLs, and uploads go straight to the
// bucket via signed URLs (Cloud Functions cap request bodies at ~32 MB, but
// clips can be 500 MB — the browser PUTs directly to Storage instead).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const isWeb = process.env.TJ_STORAGE === 'firestore';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const shotsDir = path.join(root, 'screenshots');
// On the web, videos land in the (ephemeral) temp dir before being pushed to
// the bucket — /tmp is the only writable path in a Cloud Function.
export const videosDir = isWeb ? path.join(os.tmpdir(), 'tj-videos') : path.join(root, 'videos');
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(videosDir, { recursive: true });

async function cloud() {
  return import('./firestore-store.js');
}

export async function saveShot(uid, name, buffer) {
  if (isWeb) return (await cloud()).saveShot(uid, name, buffer);
  fs.writeFileSync(path.join(shotsDir, name), buffer);
}

export async function deleteShot(uid, name) {
  if (isWeb) return (await cloud()).deleteObject(uid, name);
  fs.rm(path.join(shotsDir, name), () => {});
}

export async function deleteVideo(uid, name) {
  if (isWeb) return (await cloud()).deleteObject(uid, name);
  fs.rm(path.join(videosDir, name), () => {});
}

// Local-mode upload target for the PUT /api/uploads/local/:name endpoint — the
// browser PUTs the clip here (same request, no signed URL involved).
export function localUploadUrl(filename) {
  return `/api/uploads/local/${encodeURIComponent(filename)}`;
}

// Web-mode upload target: a short-lived signed URL straight into the bucket.
export async function uploadUrl(uid, filename) {
  if (isWeb) return (await cloud()).signedUploadUrl(uid, filename);
  return localUploadUrl(filename);
}

export async function streamShot(req, res, uid, name) {
  if (isWeb) return (await cloud()).streamObject(req, res, uid, name);
  return res.sendFile(path.join(shotsDir, name));
}

export async function streamVideo(req, res, uid, name) {
  if (isWeb) {
    // Proxy responses are capped (~32MB) and clips can be hundreds of MB, so
    // bounce the player straight to the bucket with a fresh signed read URL.
    const url = await (await cloud()).signedReadUrl(uid, name);
    res.status(302).set('Location', url).set('Accept-Ranges', 'bytes').end();
    return;
  }
  return res.sendFile(path.join(videosDir, name));
}
