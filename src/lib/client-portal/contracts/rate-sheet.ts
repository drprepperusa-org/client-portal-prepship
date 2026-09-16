/** Current saved billing configuration, not historical invoices or shipping quotes. */
export interface PortalRateSheet {
  clientId: number;
  clientName: string;
  configurationStatus: 'configured' | 'inactive' | 'not_configured';
  services: {
    pickPackFee: string;
    includedUnits: number;
    additionalUnitFee: string;
    storageFeePerCuFt: string;
    updatedAt: string;
  } | null;
  packages: Array<{
    packageId: number;
    name: string;
    dimensions: string | null;
    /** Verbatim client_package_prices.price, BEFORE billing adjustments. Never warehouse unit_cost. */
    configuredPrice: string;
    updatedAt: string;
  }>;
}
