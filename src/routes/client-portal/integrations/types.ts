export type IntegrationRow = {
  id: number;
  clientId: number | null;
  provider: string | null;
  label: string | null;
  accountIdentifier: string | null;
  source: string | null;
  active: boolean | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};
