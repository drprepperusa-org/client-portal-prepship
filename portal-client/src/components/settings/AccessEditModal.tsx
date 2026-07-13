import { useState } from 'react';
import { Store, ShieldAlert } from 'lucide-react';
import { TextInput } from '@/components/ui/Inputs';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { RadioGroup, Select } from '@/components/ui/Selection';
import { useToast } from '@/components/ui/Toast';
import { portalApi, type PortalAccessUser, type PortalClientRow } from '@/lib/api';

/* Edit modal: role, assigned client stores, and display name for one login. */
export function AccessEditModal({
  user,
  clients,
  token,
  canManageAdmins,
  onClose,
  onSaved,
}: {
  user: PortalAccessUser;
  clients: PortalClientRow[];
  token: string | null;
  canManageAdmins: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const toast = useToast();
  const clientOptions = clients.map((c) => ({ value: String(c.id), label: c.name ?? `Client ${c.id}` }));
  const validIds = new Set(clientOptions.map((o) => o.value));
  // Assignments with no matching option (inactive / out-of-fetch-window clients)
  // aren't shown as chips, but are kept here and re-merged on save so editing a
  // user never silently revokes a store the editor simply couldn't see.
  const orphanClientIds = user.clientIds.map(String).filter((id) => !validIds.has(id));

  const [role, setRole] = useState<'admin' | 'client_user'>(user.isAdmin ? 'admin' : 'client_user');
  const [name, setName] = useState(user.name ?? '');
  // Only pre-select stores that exist as real options, so we never render orphan
  // numeric chips for inactive / out-of-scope client IDs.
  const [clientIds, setClientIds] = useState<string[]>(() => user.clientIds.map(String).filter((id) => validIds.has(id)));
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!token) return;
    setSaving(true);
    try {
      await portalApi.updateAccessUser(token, user.id, {
        role,
        displayName: name.trim(),
        // Store assignment only applies to scoped client users; admins are global.
        // Re-merge orphan ids so out-of-view assignments aren't silently dropped.
        ...(role === 'client_user'
          ? { clientIds: [...new Set([...clientIds, ...orphanClientIds])].map(Number).filter((n) => Number.isInteger(n)) }
          : {}),
      });
      toast.success('Access updated', user.email);
      await onSaved();
    } catch (e) {
      toast.error('Update failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={() => !saving && onClose()} title="Edit access" maxWidth={520}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={user.email} size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{user.email}</p>
            <p className="truncate text-xs text-ink-3">{user.role ?? 'No role'}</p>
          </div>
        </div>

        <TextInput label="Display name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Jane from DJC" />

        {canManageAdmins && (
          <RadioGroup
            label="Role"
            value={role}
            onChange={setRole}
            options={[
              { value: 'admin', label: 'Admin · full global access' },
              { value: 'client_user', label: 'Client user · only assigned stores' },
            ]}
          />
        )}
        {user.isProtected && (
          <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <ShieldAlert size={14} /> Protected operator account — admin role is enforced regardless of this setting.
          </p>
        )}

        {role === 'client_user' ? (
          <div className="space-y-1.5">
            <span className="text-[13px] font-semibold text-ink-2">Assigned client stores</span>
            <Select
              multiple
              searchable
              placeholder="Search stores to assign…"
              value={clientIds}
              onChange={(v) => setClientIds(Array.isArray(v) ? v : [v])}
              options={clientOptions}
            />
            <p className="text-xs text-ink-3">Type to search. This user only sees orders and data for the stores selected here.</p>
          </div>
        ) : (
          <p className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            <Store size={14} /> Admins have global access to every client store — no assignment needed.
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" loading={saving} onClick={save}>
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  );
}
