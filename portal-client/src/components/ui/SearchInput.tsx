import { Search } from 'lucide-react';

export function SearchInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  return (
    <label className="relative flex flex-1 items-center sm:max-w-md">
      <Search size={16} className="absolute left-3 text-ink-3" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="focus-ring h-11 w-full rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90"
      />
    </label>
  );
}
