'use client';

import { cn } from '@/lib/utils';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Boxes,
  ChevronRight,
  FileText,
  LayoutDashboard,
  Package,
  PackagePlus,
  Plug,
  Receipt,
  Search,
  Settings as SettingsIcon,
  ShoppingCart,
  TrendingUp,
  Truck,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';

interface Shortcut {
  label: string;
  icon: React.ReactNode;
  link: string;
}

interface SearchResult {
  icon: React.ReactNode;
  label: string;
  description: string;
  link: string;
}

const SVGFilter = () => (
  <svg width="0" height="0" aria-hidden style={{ position: 'absolute' }}>
    <filter id="blob">
      <feGaussianBlur stdDeviation="10" in="SourceGraphic" />
      <feColorMatrix
        values="
      1 0 0 0 0
      0 1 0 0 0
      0 0 1 0 0
      0 0 0 18 -9
    "
        result="blob"
      />
      <feBlend in="SourceGraphic" in2="blob" />
    </filter>
  </svg>
);

interface ShortcutButtonProps {
  icon: React.ReactNode;
  link: string;
  onSelect: () => void;
}

const ShortcutButton = ({ icon, link, onSelect }: ShortcutButtonProps) => (
  <a
    href={link}
    onClick={(e) => {
      e.preventDefault();
      onSelect();
    }}
  >
    <div className="rounded-full cursor-pointer hover:shadow-lg opacity-30 hover:opacity-100 transition-[opacity,shadow] duration-200">
      <div className="size-16 aspect-square flex items-center justify-center">{icon}</div>
    </div>
  </a>
);

interface SpotlightPlaceholderProps {
  text: string;
  className?: string;
}

const SpotlightPlaceholder = ({ text, className }: SpotlightPlaceholderProps) => (
  <motion.div
    layout
    className={cn('absolute text-gray-500 flex items-center pointer-events-none z-10', className)}
  >
    <AnimatePresence mode="popLayout">
      <motion.p
        layoutId={`placeholder-${text}`}
        key={`placeholder-${text}`}
        initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -10, filter: 'blur(5px)' }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
      >
        {text}
      </motion.p>
    </AnimatePresence>
  </motion.div>
);

interface SpotlightInputProps {
  placeholder: string;
  hidePlaceholder: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholderClassName?: string;
}

const SpotlightInput = ({
  placeholder,
  hidePlaceholder,
  value,
  onChange,
  onSubmit,
  placeholderClassName,
}: SpotlightInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center w-full justify-start gap-3 px-6 h-16">
      <motion.div layoutId="search-icon">
        <Search className="text-[#3B82F6]" />
      </motion.div>
      <div className="flex-1 relative text-2xl">
        {!hidePlaceholder && <SpotlightPlaceholder text={placeholder} className={placeholderClassName} />}
        <motion.input
          ref={inputRef}
          layout="position"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) onSubmit();
          }}
          className="w-full bg-transparent outline-none ring-0 text-[#0F172A] caret-[#3B82F6]"
        />
      </div>
    </div>
  );
};

interface SearchResultCardProps extends SearchResult {
  isLast: boolean;
  onSelect: () => void;
}

const SearchResultCard = ({ icon, label, description, link, isLast, onSelect }: SearchResultCardProps) => (
  <a
    href={link}
    onClick={(e) => {
      e.preventDefault();
      onSelect();
    }}
    className="overflow-hidden w-full group/card"
  >
    <div
      className={cn(
        'flex items-center text-black justify-start hover:bg-white gap-3 py-2 px-2 rounded-xl hover:shadow-md w-full',
        isLast && 'rounded-b-3xl',
      )}
    >
      <div className="size-8 [&_svg]:stroke-[1.5] [&_svg]:size-6 aspect-square flex items-center justify-center text-[#3B82F6]">
        {icon}
      </div>
      <div className="flex flex-col">
        <p className="font-medium">{label}</p>
        <p className="text-xs opacity-50">{description}</p>
      </div>
      <div className="flex-1 flex items-center justify-end opacity-0 group-hover/card:opacity-100 transition-opacity duration-200">
        <ChevronRight className="size-6" />
      </div>
    </div>
  </a>
);

interface SearchResultsContainerProps {
  searchResults: SearchResult[];
  onHover: (index: number | null) => void;
  onSelect: (result: SearchResult) => void;
}

const SearchResultsContainer = ({ searchResults, onHover, onSelect }: SearchResultsContainerProps) => (
  <motion.div
    layout
    onMouseLeave={() => onHover(null)}
    className="px-2 border-t border-neutral-200 flex flex-col bg-neutral-100 max-h-96 overflow-y-auto w-full py-2"
  >
    {searchResults.length === 0 ? (
      <div className="px-4 py-6 text-sm text-neutral-500">No matches. Try another query.</div>
    ) : (
      searchResults.map((result, index) => (
        <motion.div
          key={`search-result-${result.label}-${index}`}
          onMouseEnter={() => onHover(index)}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: index * 0.04, duration: 0.16, ease: 'easeOut' }}
        >
          <SearchResultCard
            icon={result.icon}
            label={result.label}
            description={result.description}
            link={result.link}
            isLast={index === searchResults.length - 1}
            onSelect={() => onSelect(result)}
          />
        </motion.div>
      ))
    )}
  </motion.div>
);

// PrepShip-specific destinations
const PORTAL_RESULTS: SearchResult[] = [
  { icon: <LayoutDashboard />, label: 'Overview', description: 'Operations command center', link: '/dashboard' },
  { icon: <ShoppingCart />, label: 'Orders', description: 'Awaiting / shipped / cancelled queue', link: '/dashboard/orders' },
  { icon: <PackagePlus />, label: 'Inbound', description: 'Restock and receiving watch', link: '/dashboard/inbound' },
  { icon: <Truck />, label: 'Shipments', description: 'Tracking and label history', link: '/dashboard/shipments' },
  { icon: <Boxes />, label: 'Inventory', description: 'SKU stock levels', link: '/dashboard/inventory' },
  { icon: <TrendingUp />, label: 'Analysis', description: 'SKU velocity & trends', link: '/dashboard/analysis' },
  { icon: <FileText />, label: 'Reports', description: 'Operating trends', link: '/dashboard/reports' },
  { icon: <Receipt />, label: 'Invoices', description: 'Billing summaries', link: '/dashboard/invoices' },
  { icon: <Plug />, label: 'Connections', description: 'Marketplace credentials', link: '/dashboard/connections' },
  { icon: <SettingsIcon />, label: 'Settings', description: 'Account, scope, system', link: '/dashboard/settings/system' },
];

interface AppleSpotlightProps {
  shortcuts?: Shortcut[];
  results?: SearchResult[];
  isOpen?: boolean;
  onClose?: () => void;
  onNavigate?: (link: string) => void;
}

const AppleSpotlight = ({
  shortcuts = [
    { label: 'Orders', icon: <ShoppingCart />, link: '/dashboard/orders' },
    { label: 'Inbound', icon: <PackagePlus />, link: '/dashboard/inbound' },
    { label: 'Shipments', icon: <Truck />, link: '/dashboard/shipments' },
    { label: 'Inventory', icon: <Boxes />, link: '/dashboard/inventory' },
  ],
  results = PORTAL_RESULTS,
  isOpen = true,
  onClose = () => {},
  onNavigate,
}: AppleSpotlightProps) => {
  const [hovered, setHovered] = useState(false);
  const [hoveredSearchResult, setHoveredSearchResult] = useState<number | null>(null);
  const [hoveredShortcut, setHoveredShortcut] = useState<number | null>(null);
  const [searchValue, setSearchValue] = useState('');

  useEffect(() => {
    if (!isOpen) {
      setSearchValue('');
      setHoveredSearchResult(null);
      setHoveredShortcut(null);
    }
  }, [isOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const q = searchValue.trim().toLowerCase();
  const filtered = q
    ? results.filter(
        (r) =>
          r.label.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      )
    : results;

  function handleSelect(result: SearchResult) {
    onClose();
    if (onNavigate) onNavigate(result.link);
    else window.location.assign(result.link);
  }

  function handleShortcutSelect(shortcut: Shortcut) {
    onClose();
    if (onNavigate) onNavigate(shortcut.link);
    else window.location.assign(shortcut.link);
  }

  function handleEnterSubmit() {
    if (filtered.length > 0) handleSelect(filtered[0]!);
  }

  return (
    <AnimatePresence mode="wait">
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, filter: 'blur(20px) url(#blob)', scaleX: 1.3, scaleY: 1.1, y: -10 }}
          animate={{ opacity: 1, filter: 'blur(0px) url(#blob)', scaleX: 1, scaleY: 1, y: 0 }}
          exit={{ opacity: 0, filter: 'blur(20px) url(#blob)', scaleX: 1.3, scaleY: 1.1, y: 10 }}
          transition={{ stiffness: 550, damping: 50, type: 'spring' }}
          className="fixed inset-0 z-[110] flex flex-col items-start justify-start pt-[18vh] px-4 bg-[rgba(15,23,42,0.32)] backdrop-blur-[3px]"
          onClick={onClose}
        >
          <SVGFilter />

          <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => {
              setHovered(false);
              setHoveredShortcut(null);
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ filter: 'url(#blob)' }}
            className={cn(
              'w-full flex items-center justify-end gap-4 z-20 group mx-auto',
              '[&>div]:bg-neutral-100 [&>div]:text-black [&>div]:rounded-full [&>div]:backdrop-blur-xl',
              '[&_svg]:size-7 [&_svg]:stroke-[1.4]',
              'max-w-3xl',
            )}
          >
            <AnimatePresence mode="popLayout">
              <motion.div
                layoutId="search-input-container"
                transition={{ layout: { duration: 0.5, type: 'spring', bounce: 0.2 } }}
                style={{ borderRadius: '30px' }}
                className="h-full w-full flex flex-col items-center justify-start z-10 relative shadow-2xl overflow-hidden border border-neutral-200"
              >
                <SpotlightInput
                  placeholder={
                    hoveredShortcut !== null
                      ? shortcuts[hoveredShortcut]!.label
                      : hoveredSearchResult !== null && filtered[hoveredSearchResult]
                      ? filtered[hoveredSearchResult]!.label
                      : 'Search orders, SKUs, pages…'
                  }
                  placeholderClassName={hoveredSearchResult !== null ? 'text-black bg-white' : 'text-gray-500'}
                  hidePlaceholder={!(hoveredSearchResult !== null || !searchValue)}
                  value={searchValue}
                  onChange={setSearchValue}
                  onSubmit={handleEnterSubmit}
                />

                {searchValue && (
                  <SearchResultsContainer
                    searchResults={filtered}
                    onHover={setHoveredSearchResult}
                    onSelect={handleSelect}
                  />
                )}
              </motion.div>

              {hovered &&
                !searchValue &&
                shortcuts.map((shortcut, index) => (
                  <motion.div
                    key={`shortcut-${shortcut.label}-${index}`}
                    onMouseEnter={() => setHoveredShortcut(index)}
                    layout
                    initial={{ scale: 0.7, x: -1 * (64 * (index + 1)) }}
                    animate={{ scale: 1, x: 0 }}
                    exit={{
                      scale: 0.7,
                      x: 1 * (16 * (shortcuts.length - index - 1) + 64 * (shortcuts.length - index - 1)),
                    }}
                    transition={{ duration: 0.6, type: 'spring', bounce: 0.2, delay: index * 0.05 }}
                    className="rounded-full cursor-pointer"
                  >
                    <ShortcutButton
                      icon={shortcut.icon}
                      link={shortcut.link}
                      onSelect={() => handleShortcutSelect(shortcut)}
                    />
                  </motion.div>
                ))}
            </AnimatePresence>
          </div>

          {/* Hint footer */}
          <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-full bg-white/90 px-4 py-2 text-[11px] font-medium text-neutral-600 shadow-md backdrop-blur">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px]">↵</kbd> open
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-neutral-300 bg-neutral-50 px-1.5 py-0.5 font-mono text-[10px]">esc</kbd> close
            </span>
            <ArrowRight className="size-3 opacity-50" />
            <span>type to filter</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export { AppleSpotlight };
