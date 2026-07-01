import { useState } from 'react';
import { SectionTitle } from '@/components/ui/Glass';
import { TextInput, EmailInput, TextArea } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { LS_PROFILE, loadJSON } from './storage';

export function ProfileTab() {
  const toast = useToast();
  const { email: authEmail } = useAuth();
  const savedProfile = loadJSON(LS_PROFILE, { name: '', bio: '' });
  const [name, setName] = useState(savedProfile.name || (authEmail ? authEmail.split('@')[0] : ''));
  const [bio, setBio] = useState(savedProfile.bio);

  function saveProfile() {
    try {
      localStorage.setItem(LS_PROFILE, JSON.stringify({ name, bio }));
      toast.success('Profile saved', 'Your details are stored on this device.');
    } catch {
      toast.error("Couldn't save", 'Local storage is unavailable in this browser.');
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Profile" subtitle="Update your personal details" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextInput label="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <EmailInput label="Email" value={authEmail ?? ''} readOnly helper="Managed by your login — contact your operator to change it." />
      </div>
      <TextArea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} />
      <div className="flex justify-end"><Button onClick={saveProfile}>Save changes</Button></div>
    </div>
  );
}
