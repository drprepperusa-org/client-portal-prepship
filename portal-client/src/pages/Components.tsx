import { useState } from 'react';
import { Mail, Search, Plus, Send, Inbox } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { TextInput, TextArea, PasswordInput, EmailInput, UrlInput, NumberInput } from '@/components/ui/Inputs';
import { Checkbox, RadioGroup, Select } from '@/components/ui/Selection';
import { DatePicker } from '@/components/ui/DatePicker';
import { FileUpload } from '@/components/ui/FileUpload';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { Chip, Skeleton, SkeletonRows, ProgressBar, Tooltip, EmptyState } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import type { Accent } from '@/lib/accents';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassPanel className="p-5">
      <SectionTitle title={title} />
      <div className="mt-4">{children}</div>
    </GlassPanel>
  );
}

const ACCENTS: Accent[] = ['indigo', 'teal', 'amber', 'rose', 'emerald', 'sky', 'violet'];
const SELECT_OPTS = [
  { value: 'ups', label: 'UPS' },
  { value: 'fedex', label: 'FedEx' },
  { value: 'usps', label: 'USPS' },
  { value: 'dhl', label: 'DHL' },
];

export default function Components() {
  const toast = useToast();
  const [loadingBtn, setLoadingBtn] = useState(false);
  const [text, setText] = useState('Acme Co.');
  const [area, setArea] = useState('');
  const [pw, setPw] = useState('');
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [num, setNum] = useState(12);
  const [checks, setChecks] = useState({ a: true, b: false });
  const [radio, setRadio] = useState('ground');
  const [single, setSingle] = useState<string | string[]>('ups');
  const [multi, setMulti] = useState<string | string[]>(['ups', 'fedex']);
  const [date, setDate] = useState<{ start: Date | null; end: Date | null }>({ start: new Date(2026, 4, 29), end: null });
  const [color, setColor] = useState('#03A9F4');

  return (
    <div className="space-y-4">
      <GlassPanel className="p-5">
        <SectionTitle title="Component library" subtitle="Every glass component, variant, and state in one place" />
      </GlassPanel>

      {/* Buttons */}
      <Block title="Buttons">
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="icon" aria-label="Add"><Plus size={18} /></Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button leadingIcon={<Send size={16} />}>Leading icon</Button>
            <Button variant="secondary" trailingIcon={<Plus size={16} />}>Trailing icon</Button>
            <Button disabled>Disabled</Button>
            <Button
              loading={loadingBtn}
              onClick={() => {
                setLoadingBtn(true);
                setTimeout(() => setLoadingBtn(false), 1600);
              }}
            >
              {loadingBtn ? 'Saving…' : 'Click to load'}
            </Button>
          </div>
        </div>
      </Block>

      {/* Text inputs */}
      <Block title="Text inputs">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextInput label="Text" value={text} onChange={(e) => setText(e.target.value)} icon={<Search size={16} />} helper="Short single-line text" />
          <EmailInput label="Email" value={email} onChange={(e) => setEmail(e.target.value)} icon={<Mail size={16} />} helper="Validates @ format" />
          <PasswordInput label="Password" value={pw} onChange={(e) => setPw(e.target.value)} helper="Toggle visibility with the eye" />
          <UrlInput label="URL" value={url} onChange={(e) => setUrl(e.target.value)} helper="Validates web address" />
          <NumberInput label="Number (stepper)" value={num} onValueChange={setNum} stepper min={0} max={99} helper="Digits with min/max" />
          <TextInput label="Error state" defaultValue="invalid" error="This field has an error" />
          <TextInput label="Success state" defaultValue="all good" success="Looks great!" />
          <TextInput label="Disabled" defaultValue="Read only" disabled />
        </div>
        <div className="mt-4">
          <TextArea label="Textarea (auto-grows)" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Type a few lines…" />
        </div>
      </Block>

      {/* Selection inputs */}
      <Block title="Selection inputs">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-3">
            <p className="text-[13px] font-semibold text-ink-2">Checkbox</p>
            <Checkbox label="Express handling" checked={checks.a} onChange={(v) => setChecks((c) => ({ ...c, a: v }))} />
            <Checkbox label="Signature required" checked={checks.b} onChange={(v) => setChecks((c) => ({ ...c, b: v }))} />
            <Checkbox label="Disabled" checked disabled onChange={() => {}} />
          </div>
          <RadioGroup label="Radio" value={radio} onChange={setRadio} options={[{ value: 'ground', label: 'Ground' }, { value: 'air', label: '2-Day Air' }, { value: 'priority', label: 'Priority' }]} />
          <Select label="Select (searchable)" searchable options={SELECT_OPTS} value={single} onChange={setSingle} />
          <Select label="Multi-select" multiple options={SELECT_OPTS} value={multi} onChange={setMulti} />
        </div>
      </Block>

      {/* Media inputs */}
      <Block title="Media & tool inputs">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <DatePicker label="Date" value={date} onChange={setDate} />
            <DatePicker label="Date range" range value={date} onChange={setDate} />
            <ColorPicker label="Color" value={color} onChange={setColor} />
          </div>
          <FileUpload label="File upload (drag & drop)" />
        </div>
      </Block>

      {/* Chips & feedback */}
      <Block title="Status chips">
        <div className="flex flex-wrap gap-2.5">
          {ACCENTS.map((a) => (
            <Chip key={a} accent={a}>{a[0].toUpperCase() + a.slice(1)}</Chip>
          ))}
        </div>
      </Block>

      <Block title="Progress & skeletons">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <ProgressBar value={72} accent="indigo" />
            <ProgressBar value={45} accent="teal" />
            <ProgressBar value={91} accent="emerald" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-6 w-1/2" />
            <SkeletonRows rows={3} />
          </div>
        </div>
      </Block>

      {/* Tooltips & toasts */}
      <Block title="Tooltips & toasts">
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip label="This is a tooltip" side="top">
            <Button variant="secondary">Hover for tooltip</Button>
          </Tooltip>
          <Button onClick={() => toast.success('Saved!', 'Your changes were stored.')}>Success toast</Button>
          <Button variant="danger" onClick={() => toast.error('Something failed', 'Please try again.')}>Error toast</Button>
          <Button variant="secondary" onClick={() => toast.info('Heads up', 'New orders imported.')}>Info toast</Button>
          <Button variant="ghost" onClick={() => toast.warning('Low stock', '7 SKUs below threshold.')}>Warning toast</Button>
        </div>
      </Block>

      {/* Empty state */}
      <Block title="Empty state">
        <EmptyState icon={<Inbox size={26} />} title="Nothing here yet" message="When data arrives, it will show up in this space." action={<Button size="sm" leadingIcon={<Plus size={15} />}>Add item</Button>} />
      </Block>
    </div>
  );
}
