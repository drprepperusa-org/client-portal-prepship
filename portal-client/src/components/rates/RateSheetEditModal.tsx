import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth';
import { portalApi, type PortalRateSheet } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TextInput } from '@/components/ui/Inputs';
import { useToast } from '@/components/ui/Toast';

export type RateSheetEditor = { kind: 'services' } | { kind: 'add-box' } | { kind: 'package'; box: PortalRateSheet['packages'][number] };
export function RateSheetEditModal({ sheet, editor, onClose, onSaved, onDenied }: {
  sheet: PortalRateSheet; editor: RateSheetEditor; onClose: () => void; onSaved: () => Promise<void>; onDenied: () => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>((): Record<string, string> => editor.kind === 'services' ? {
    pickPackFee: sheet.services?.pickPackFee ?? '', pickPackMaxUnits: String(sheet.services?.includedUnits ?? 1),
    additionalUnitFee: sheet.services?.additionalUnitFee ?? '', storageFeePerCuFt: sheet.services?.storageFeePerCuFt ?? '',
  } : editor.kind === 'package' ? { price: editor.box.configuredPrice } : { name: '', length: '', width: '', height: '', charge: '' });
  const title = editor.kind === 'services' ? (sheet.services ? 'Edit service rates' : 'Add service rates') : editor.kind === 'package' ? 'Edit box price' : 'Add box';
  const fields = editor.kind === 'services' ? [
    ['pickPackFee', 'Pick & pack ($)', '0.01'], ['pickPackMaxUnits', 'Included units', '1'],
    ['additionalUnitFee', 'Additional unit ($)', '0.01'], ['storageFeePerCuFt', 'Storage per cubic foot / month ($)', '0.0001'],
  ] : editor.kind === 'package' ? [['price', 'Price per box ($)', '0.01']] : [
    ['name', 'Box name (optional)', 'text'], ['length', 'Length (in)', 'any'], ['width', 'Width (in)', 'any'],
    ['height', 'Height (in)', 'any'], ['charge', 'Price per box ($)', '0.01'],
  ];
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || saving) return;
    setSaving(true); setError('');
    const body: Record<string, unknown> = { clientId: sheet.clientId, ...values };
    if (editor.kind === 'services') body.pickPackMaxUnits = Number(values.pickPackMaxUnits);
    if (editor.kind === 'package') body.packageId = editor.box.packageId;
    if (editor.kind === 'add-box') {
      for (const field of ['length', 'width', 'height']) body[field] = Number(values[field]);
      if (!values.name?.trim()) delete body.name;
    }
    try {
      await portalApi.saveRateSheet(accessToken, editor.kind, body);
      toast.success('Rates saved', 'PrepShip and the Client Portal now use these saved rates.');
      await onSaved(); onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save. Refresh before retrying.');
      if ((failure as { status?: number }).status === 403) onDenied();
    } finally { setSaving(false); }
  }
  return <Modal open title={title} onClose={() => { if (!saving) onClose(); }}>
    <form onSubmit={save} className="space-y-4">
      <p className="text-sm font-semibold text-ink">{sheet.clientName}{editor.kind === 'package' ? ` · ${editor.box.name}` : ''}</p>
      <p className="text-sm text-ink-3">Saves the configured rates used by both apps. Existing invoice charges are not changed by this save.</p>
      <fieldset disabled={saving} className="grid gap-4 sm:grid-cols-2">
        {fields.map(([field, label, step]) => <TextInput key={field} label={label} type={step === 'text' ? 'text' : 'number'}
          required={field !== 'name'} min={['length', 'width', 'height', 'pickPackMaxUnits'].includes(field!) ? (field === 'pickPackMaxUnits' ? 1 : 0.000001) : 0}
          step={step === 'text' ? undefined : step} maxLength={field === 'name' ? 150 : undefined}
          value={values[field!] ?? ''} onChange={event => setValues(current => ({ ...current, [field!]: event.target.value }))} />)}
      </fieldset>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={saving}>Save rates</Button>
      </div>
    </form>
  </Modal>;
}
