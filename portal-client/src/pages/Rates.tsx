import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Box, ChevronDown, ChevronLeft, ChevronRight, Layers, RefreshCw, ReceiptText, Search, Warehouse, type LucideIcon } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { useMe, useRateSheet } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import type { PortalRateSheet } from '@/lib/api';
import { shortDate } from '@/lib/status';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const statusLabels = { configured: 'Configured', inactive: 'Billing inactive', not_configured: 'Services not configured' };

const PACKAGES_PER_PAGE = 12;

function PackageRate({ box }: { box: PortalRateSheet['packages'][number] }) {
  // Display formatting only: preserve named packages, omit repeated dimensions.
  const normalized = (text: string) => text.toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '').replace(/in$/, '');
  const dimensionName = box.dimensions && normalized(box.name) === normalized(box.dimensions);
  return (
    <li className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
      <Box size={23} className="hidden shrink-0 text-ink-2 sm:block" aria-hidden />
      <div className="min-w-0 flex-1 sm:border-l sm:border-slate-200 sm:pl-3">
        <h4 className="break-words text-sm font-semibold text-ink">{dimensionName ? box.dimensions : box.name}</h4>
        {!dimensionName && <p className="mt-1 break-words text-xs text-ink-3">{box.dimensions ?? 'Dimensions not recorded'}</p>}
        <p className="mt-1 text-xs text-ink-3">Updated {shortDate(box.updatedAt)}</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-lg font-semibold text-ink tnum">{currency.format(Number(box.configuredPrice))}</p>
        <p className="text-xs text-ink-3">/ box</p>
      </div>
    </li>
  );
}

export default function Rates() {
  const me = useMe();
  const canView = Boolean(me.data?.canViewFinancials);
  const query = useRateSheet(canView);
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SectionTitle title="Rate sheet" subtitle="Current configured PrepShip service pricing · USD" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" leadingIcon={<RefreshCw size={16} />} disabled={!canView || query.isFetching}
            onClick={() => void query.refetch()}>Refresh rates</Button>
          <Link to="/invoices"><Button leadingIcon={<ReceiptText size={16} />}>View invoices</Button></Link>
        </div>
      </GlassPanel>
      <p className="px-1 text-xs leading-relaxed text-ink-3">
        These are the current saved rates for the selected client, regardless of the date filter.
        Invoice charges may include shipment-specific adjustments. Contact your account manager to change your rates.
      </p>
      <QueryState isLoading={me.isLoading || (canView && query.isLoading)}
        isError={me.isError || (canView && query.isError)} isUpdating={canView && query.isFetching && !query.isLoading}
        onRetry={() => void (me.isError ? me.refetch() : query.refetch())}
        isEmpty={canView && rows.length === 0} emptyTitle="No rate sheets for this client selection"
        emptyMessage="Choose another client or ask your account manager to check your access.">
        {canView ? (
          <div className="space-y-4">{rows.map((row, index) => (
            <ClientRates key={row.clientId} sheet={row} defaultOpen={rows.length === 1 || index === 0} />
          ))}</div>
        ) : (
          <GlassPanel className="p-6">
            <h2 className="font-semibold text-ink">Financial access required</h2>
            <p className="mt-2 text-sm text-ink-3">Ask your account manager for permission to view your rate sheet.</p>
          </GlassPanel>
        )}
      </QueryState>
    </div>
  );
}

function ServiceRate({ label, value, unit, icon: Icon }: { label: string; value: string; unit: string; icon: LucideIcon }) {
  return (
    <div className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-3 rounded-xl border border-brand-100 bg-brand-50/50 p-4">
      <dt className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon size={20} className="shrink-0 text-brand-700" aria-hidden />{label}</dt>
      <dd className="row-span-2 text-xl font-semibold text-ink tnum">{currency.format(Number(value))}</dd>
      <dd className="mt-1 text-xs text-ink-3">{unit}</dd>
    </div>
  );
}

function ClientRates({ sheet, defaultOpen }: { sheet: PortalRateSheet; defaultOpen: boolean }) {
  const service = sheet.services;
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [packageQuery, setPackageQuery] = useState('');
  const [packagePage, setPackagePage] = useState(1);
  const packageListId = useId();
  const packagePanelId = `client-rates-${sheet.clientId}`;
  const filteredPackages = useMemo(() => {
    const query = packageQuery.trim().toLocaleLowerCase();
    if (!query) return sheet.packages;
    return sheet.packages.filter((box) =>
      `${box.name} ${box.dimensions ?? ''}`.toLocaleLowerCase().includes(query),
    );
  }, [packageQuery, sheet.packages]);
  // Paginate only the already-scoped DTO. Pricing and relevance stay backend-owned.
  const pageCount = Math.max(1, Math.ceil(filteredPackages.length / PACKAGES_PER_PAGE));
  const currentPage = Math.min(packagePage, pageCount);
  const pageStart = (currentPage - 1) * PACKAGES_PER_PAGE;
  const visiblePackages = filteredPackages.slice(pageStart, pageStart + PACKAGES_PER_PAGE);
  const firstPageButton = Math.max(1, Math.min(currentPage - 2, pageCount - 4));

  useEffect(() => {
    if (defaultOpen) setIsOpen(true);
  }, [defaultOpen]);

  return (
    <GlassPanel className="p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">{sheet.clientName}</h2>
          <p className="mt-1 text-xs text-ink-3">
            {service ? `Service rates updated ${shortDate(service.updatedAt)}` : 'Service rates have not been configured.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-ink-2">
            {statusLabels[sheet.configurationStatus]}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={isOpen}
            aria-controls={packagePanelId}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} rates for ${sheet.clientName}`}
            trailingIcon={<ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
            onClick={() => setIsOpen((open) => !open)}
          >
            {isOpen ? 'Hide details' : 'View details'}
          </Button>
        </div>
      </div>
      {isOpen && (
        <div id={packagePanelId} className="mt-5 space-y-5">
          {sheet.configurationStatus === 'inactive' && (
            <p className="rounded-glass-sm bg-amber-50 p-3 text-sm text-amber-800">
              Billing is inactive for this client. The saved rates below are shown for reference.
            </p>
          )}
          {service ? (
            <dl className="grid gap-3 lg:grid-cols-3">
              <ServiceRate icon={Box} label="Pick & pack" value={service.pickPackFee}
                unit={`Includes up to ${service.includedUnits} ${service.includedUnits === 1 ? 'unit' : 'units'}`} />
              <ServiceRate icon={Layers} label="Additional units" value={service.additionalUnitFee} unit="Per additional unit" />
              <ServiceRate icon={Warehouse} label="Storage" value={service.storageFeePerCuFt} unit="Per cubic foot / month" />
            </dl>
          ) : (
            <p className="rounded-glass-sm bg-slate-50 p-4 text-sm text-ink-3">
              Prep and storage rates are not configured. A missing rate does not mean the service is free.
            </p>
          )}
          <section aria-label={`Packaging rates for ${sheet.clientName}`} className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-ink">Packaging rates <span className="ml-2 text-sm font-normal text-ink-3">{sheet.packages.length} packages</span></h3>
                <p className="mt-1 text-sm text-ink-3">Configured prices for your client. Final charges appear on invoices.</p>
              </div>
              {sheet.packages.length > 0 && (
                <label className="relative flex w-full items-center sm:max-w-sm">
                  <Search size={16} className="absolute left-3 text-ink-3" aria-hidden />
                  <input
                    type="search"
                    list={packageListId}
                    value={packageQuery}
                    onChange={(event) => { setPackageQuery(event.target.value); setPackagePage(1); }}
                    placeholder="Search box size or name"
                    aria-label={`Find packaging for ${sheet.clientName}`}
                    autoComplete="off"
                    className="focus-ring h-11 w-full rounded-glass-sm border border-white/80 bg-white/60 pl-9 pr-3 text-sm text-ink ring-1 ring-slate-200/70 placeholder:text-slate-400 focus:bg-white/90"
                  />
                  <datalist id={packageListId}>
                    {sheet.packages.map((box) => <option key={box.packageId} value={box.name} />)}
                  </datalist>
                </label>
              )}
            </div>
            {filteredPackages.length ? (
              <>
                <ul aria-label={`Packages for ${sheet.clientName}`} className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {visiblePackages.map((box) => <PackageRate key={box.packageId} box={box} />)}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                  <p className="text-xs text-ink-3" role="status">Showing {pageStart + 1}–{pageStart + visiblePackages.length} of {filteredPackages.length} packages</p>
                  {pageCount > 1 && <nav aria-label={`Packaging pages for ${sheet.clientName}`} className="flex flex-wrap items-center gap-1">
                    <Button variant="ghost" className="w-11 px-0" aria-label="Previous packaging page" disabled={currentPage === 1} onClick={() => setPackagePage(currentPage - 1)}><ChevronLeft size={17} aria-hidden /></Button>
                    {Array.from({ length: Math.min(5, pageCount) }, (_, index) => firstPageButton + index).map((page) => (
                      <button key={page} type="button" aria-label={`Packaging page ${page}`} aria-current={page === currentPage ? 'page' : undefined}
                        onClick={() => setPackagePage(page)} className={cn('focus-ring h-11 min-w-11 rounded-lg border text-sm font-semibold', page === currentPage ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-ink-2 hover:bg-brand-50')}>
                        {page}
                      </button>
                    ))}
                    <Button variant="ghost" className="w-11 px-0" aria-label="Next packaging page" disabled={currentPage === pageCount} onClick={() => setPackagePage(currentPage + 1)}><ChevronRight size={17} aria-hidden /></Button>
                  </nav>}
                </div>
              </>
            ) : sheet.packages.length ? (
              <p className="rounded-glass-sm bg-slate-50 p-4 text-sm text-ink-3">No packaging matches “{packageQuery}”.</p>
            ) : (
              <p className="rounded-glass-sm bg-slate-50 p-4 text-sm text-ink-3">No published prices for this client’s relevant packaging yet.</p>
            )}
            <p className="text-xs text-ink-3">Only your client’s relevant boxes with saved prices are listed, including $0.00 prices.</p>
          </section>
        </div>
      )}
    </GlassPanel>
  );
}
