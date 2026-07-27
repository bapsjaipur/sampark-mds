// src/pages/ProfilePage.jsx
import { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { updatePassword } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { auth, db } from '../lib/firebase';
import { signOut } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { Input, Label } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import PhotoUploader from '../components/photo/PhotoUploader';

export default function ProfilePage() {
  const { volunteer, role } = useAuth();
  const { showToast } = useToast();

  const [form, setForm] = useState({ name: '', mobile: '' });
  const [photoURL, setPhotoURL] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [pwdSaving, setPwdSaving] = useState(false);

  useEffect(() => {
    if (volunteer) {
      setForm({
        name: volunteer.name || '',
        mobile: volunteer.mobile || '',
      });
      setPhotoURL(volunteer.profilePhotoURL || '');
    }
  }, [volunteer]);

  async function handlePhotoUpload(url) {
    try {
       await updateDoc(doc(db, 'volunteers', volunteer.id), { profilePhotoURL: url });
       setPhotoURL(url);
    } catch (err) {
       showToast({ type: 'error', message: 'Failed to save photo in database.' });
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) return showToast({ type: 'error', message: 'Name is required.' });
    if (!/^\d{10}$/.test(form.mobile.replace(/\D/g, ''))) return showToast({ type: 'error', message: 'Mobile must be 10 digits.' });

    if (form.name === volunteer.name && form.mobile === volunteer.mobile) {
       return showToast({ type: 'success', message: 'No changes made.' });
    }

    setSaving(true);
    try {
      const functions = getFunctions();
      const updateVolunteerAccount = httpsCallable(functions, 'updateVolunteerAccount');
      await updateVolunteerAccount({
        volunteerId: volunteer.id,
        name: form.name.trim(),
        mobile: form.mobile.replace(/\D/g, ''),
        profilePhotoURL: photoURL
      });
      showToast({ type: 'success', message: 'Profile updated successfully!' });
    } catch (err) {
      console.error(err);
      showToast({ type: 'error', message: err.message || "Couldn't save changes." });
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange(e) {
    e.preventDefault();
    if (newPassword.length < 6) {
       return showToast({ type: 'error', message: 'Password must be at least 6 characters.' });
    }
    setPwdSaving(true);
    try {
      const user = auth.currentUser;
      if (user) {
        await updatePassword(user, newPassword);
        setNewPassword('');
        showToast({ type: 'success', message: 'Password updated successfully!' });
      } else {
        throw new Error('User not authenticated.');
      }
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/requires-recent-login') {
         showToast({ type: 'error', message: 'For security, please sign out and sign in again to change password.' });
      } else {
         showToast({ type: 'error', message: err.message || "Password change failed." });
      }
    } finally {
      setPwdSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12 space-y-6">
      <h1 className="mb-8 text-2xl font-semibold text-slate-900 tracking-tight">My Profile</h1>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        {/* Photo Uploader Header */}
        <div className="bg-slate-50/50 p-6 flex flex-col items-center border-b border-slate-100 space-y-4">
          <PhotoUploader
            individualId={volunteer?.id}
            currentPhotoURL={photoURL}
            onUploaded={handlePhotoUpload}
          />
          <div className="text-center">
            <p className="font-semibold text-slate-900 text-lg">{volunteer?.name}</p>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Role: <span className="font-semibold text-slate-700">{role?.name || 'Karyakarta'}</span></p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold justify-center">
            {volunteer?.assignedAreas?.map(a => <span key={a} className="rounded-full bg-orange-50 px-2.5 py-0.5 text-orange-700">{a}</span>)}
            {volunteer?.assignedMandals?.map(m => <span key={m} className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-700">{m}</span>)}
          </div>
        </div>

        {/* Profile Form */}
        <form onSubmit={handleSave} className="p-6 space-y-5">
          <div>
            <Label required>Full Name</Label>
            <Input
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
            />
          </div>
          <div>
            <Label required>Mobile Number <span className="text-slate-400 font-normal ml-1">(Your login ID)</span></Label>
            <Input
              value={form.mobile}
              onChange={e => setForm({...form, mobile: e.target.value})}
              inputMode="numeric"
              maxLength={10}
            />
            <p className="mt-1.5 text-xs text-amber-600">If you change this number, you must use the new number next time you log in.</p>
          </div>

          <div className="pt-4 border-t border-slate-100 flex justify-between items-center">
            <Button type="button" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => signOut(auth)}>
               <LogOut className="h-4 w-4 mr-2" /> Sign Out
            </Button>
            <Button type="submit" variant="accent" disabled={saving}>
              {saving ? 'Saving...' : 'Save Profile'}
            </Button>
          </div>
        </form>
      </div>

      {/* Change Password Block */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Change Password</h2>
        <p className="text-sm text-slate-500 mb-4">Update your account login password below.</p>

        <form onSubmit={handlePasswordChange} className="space-y-4">
          <div>
            <Label required>New Password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete="new-password"
            />
          </div>
          <Button type="submit" variant="accent" disabled={pwdSaving || !newPassword.trim()}>
            {pwdSaving ? 'Updating...' : 'Update Password'}
          </Button>
        </form>
      </div>
    </div>
  );
}