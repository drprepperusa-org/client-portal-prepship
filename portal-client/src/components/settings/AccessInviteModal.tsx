import { useState, type FormEvent } from 'react';
import { Info, Mail, Send, ShieldCheck, Store, UserPlus } from 'lucide-react';
import { EmailInput, TextInput } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { RadioGroup, Select } from '@/components/ui/Selection';
import { useToast } from '@/components/ui/Toast';
import { portalApi, type PortalClientRow } from '@/lib/api';

export function AccessInviteModal({
  clients,
  token,
  onClose,
  onInvited,
}: {
  clients: PortalClientRow[];
  token: string | null;
  onClose: () => void;
  onInvited: () => Promise<void> | void;
}) {
  const toast = useToast();
  const clientOptions = clients
    .filter((client) => client.active !== false)
    .map((client) => ({ value: String(client.id), label: client.name ?? `Client ${client.id}` }));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'client_user' | 'admin'>('client_user');
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    try {
      await portalApi.inviteAccessUser(token, {
        email: email.trim(),
        displayName: name.trim(),
        role,
        clientIds: role === 'client_user' ? clientIds.map(Number).filter((id) => Number.isInteger(id)) : [],
      });
      toast.success('Invitation sent', email.trim());
      await onInvited();
      onClose();
    } catch (err) {
      toast.error('Invite failed', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="Invite user" maxWidth={540}>
      <form onSubmit={submit} className="space-y-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <EmailInput
            label="Email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icon={<Mail size={16} />}
            placeholder="you@company.com"
          />
          <TextInput
            label="Display name"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            icon={<UserPlus size={16} />}
            placeholder="Jane Smith"
          />
        </div>

        <RadioGroup
          label="Role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'client_user', label: 'Client user - assigned stores' },
            { value: 'admin', label: 'Admin - global access' },
          ]}
        />

        {role === 'client_user' ? (
          <Select
            multiple
            searchable
            label="Assigned client stores"
            placeholder="Select stores"
            value={clientIds}
            onChange={(value) => setClientIds(Array.isArray(value) ? value : [value])}
            options={clientOptions}
          />
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            <ShieldCheck size={14} /> Admins can access every client store.
          </p>
        )}

        {role === 'client_user' && clientOptions.length === 0 && (
          <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <Store size={14} /> No active client stores are available. The user can still activate their login, then you can assign stores later.
          </p>
        )}

        {role === 'client_user' && clientOptions.length > 0 && clientIds.length === 0 && (
          <p className="flex items-center gap-1.5 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
            <Info size={14} /> No stores selected yet. This creates the login now; assign store access when it is ready.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={saving} trailingIcon={<Send size={15} />}>
            Send invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}
