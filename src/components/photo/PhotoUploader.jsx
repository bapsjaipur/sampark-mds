// src/components/photo/PhotoUploader.jsx — Phase 16: separate "Take Photo"
// (opens the device camera directly via capture="environment") and "Choose
// from Gallery" (plain file picker) options, instead of one ambiguous file
// input. On desktop browsers without a camera, "Take Photo" just falls
// back to the regular file picker (browser behavior, not something to
// special-case here).
//
// COMPRESSION STANDARD (see cropImage.js for the implementation): every
// photo is downscaled to 512x512 and re-encoded as JPEG at 85% quality
// before upload, regardless of the original size. A phone camera photo
// (often 8-12MB) typically becomes 30-150KB after this — roughly a 100x
// reduction — which is what keeps Firebase Storage usage low across
// thousands of contacts. This happens automatically; nothing further is
// needed from the person uploading.
import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { Camera, Image as ImageIcon } from "lucide-react";
import { storage } from "../../lib/firebase";
import { getCroppedImageBlob } from "./cropImage";
import { useToast } from "../../contexts/ToastContext";
import Modal from "../ui/Modal";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";

export default function PhotoUploader({ individualId, currentPhotoURL, onUploaded }) {
  const [rawImageSrc, setRawImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [outputSizeKB, setOutputSizeKB] = useState(null);
  const { showToast } = useToast();

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast({ type: "error", message: "Please choose an image file." }); return; }
    if (file.size > 15 * 1024 * 1024) { showToast({ type: "error", message: "Image is too large (max 15MB before compression)." }); return; }
    const reader = new FileReader();
    reader.onload = () => setRawImageSrc(reader.result);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const onCropComplete = useCallback((_croppedArea, croppedPixels) => setCroppedAreaPixels(croppedPixels), []);

  const handleSave = async () => {
    if (!rawImageSrc || !croppedAreaPixels) return;
    setUploading(true);
    try {
      const blob = await getCroppedImageBlob(rawImageSrc, croppedAreaPixels);
      setOutputSizeKB(Math.round(blob.size / 1024));
      const storageRef = ref(storage, `profile-photos/${individualId}.jpg`);
      await uploadBytes(storageRef, blob, { contentType: "image/jpeg" });
      const url = await getDownloadURL(storageRef);
      onUploaded(url);
      showToast({ type: "success", message: `Photo updated (${Math.round(blob.size / 1024)}KB).` });
      setRawImageSrc(null);
    } catch (err) {
      console.error(err);
      showToast({ type: "error", message: "Couldn't upload the photo. Try again." });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <Avatar src={currentPhotoURL} size="lg" />

      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
        <Camera className="h-3.5 w-3.5" /> Take photo
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
      </label>

      <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
        <ImageIcon className="h-3.5 w-3.5" /> Choose from gallery
        <input type="file" accept="image/*" className="hidden" onChange={onFileChange} />
      </label>

      <Modal open={Boolean(rawImageSrc)} onClose={() => setRawImageSrc(null)} title="Adjust photo" size="sm">
        <div className="relative h-72 w-full overflow-hidden rounded-lg bg-slate-900">
          {rawImageSrc && <Cropper image={rawImageSrc} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <span className="text-xs text-slate-400">Zoom</span>
          <input type="range" min={1} max={3} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="flex-1 accent-orange-500" />
        </div>
        <p className="mt-2 text-xs text-slate-400">Photos are automatically compressed to keep storage usage low (typically under 150KB).</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRawImageSrc(null)}>Cancel</Button>
          <Button variant="accent" onClick={handleSave} disabled={uploading}>{uploading ? "Uploading…" : "Save photo"}</Button>
        </div>
      </Modal>
    </div>
  );
}
