import type { RequestAuth } from '../transport';
import type { ListOpts } from '@client-portal-contracts/common';
import type {
  NewInspectionInput,
  NewReturnInput,
  PortalReturnDetail,
  PortalReturnReceivingRow,
  PortalReturnRow,
  ReturnDeliveryResult,
  ReturnLabelResult,
  UpdateReturnRecipientNameInput,
} from '@client-portal-contracts/returns';
import { scopedList } from '../scope';
import { apiGet, apiPatch, apiPost, apiUpload } from '../transport';

export const returnsApi = {
  returns: (token: RequestAuth, opts: ListOpts & { orderId?: number } = {}) =>
    scopedList<PortalReturnRow>(token, '/api/client-portal/returns', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      search: opts.search,
      status: opts.status && opts.status !== 'all' ? opts.status : undefined,
      clientId: opts.clientId,
      orderId: opts.orderId,
    }),
  returnDetail: (token: RequestAuth, id: number) =>
    apiGet<{ data: PortalReturnDetail }>(token, `/api/client-portal/returns/${id}`),
  createReturn: (token: RequestAuth, body: NewReturnInput) =>
    apiPost<{ data: { id: number; status: string } }>(token, '/api/client-portal/returns', body),
  updateReturnRecipientName: (token: RequestAuth, id: number, body: UpdateReturnRecipientNameInput) =>
    apiPatch<{ data: { id: number; returnRecipientName: string } }>(
      token,
      `/api/client-portal/returns/${id}/recipient-name`,
      body,
    ),
  createReturnLabel: (token: RequestAuth, id: number) =>
    apiPost<{ data: ReturnLabelResult }>(token, `/api/client-portal/returns/${id}/label`),
  deliverReturn: (token: RequestAuth, id: number) =>
    apiPost<{ data: ReturnDeliveryResult }>(token, `/api/client-portal/returns/${id}/deliver`),
  // CP-058 AC-3: the SECOND later path — a label bought outside PrepShip. No carrier or
  // service is sent: those are server-internal, and letting the form choose one would make
  // the portal a second source of truth for label identity.
  assignReturnExternalTracking: (
    token: RequestAuth,
    id: number,
    body: { trackingNumber: string; amountPaid: string },
  ) =>
    apiPost<{ data: { id: number; returnShipmentId: number; status: string } }>(
      token,
      `/api/client-portal/returns/${id}/external-tracking`,
      body,
    ),
  // CP-058 AC-4: optional PDF for that external label. Private bucket, path only.
  uploadReturnExternalLabelPdf: (token: RequestAuth, id: number, file: File) => {
    const form = new FormData();
    form.set('file', file);
    return apiUpload<{ data: { id: number; pdfAttached: boolean } }>(
      token,
      `/api/client-portal/returns/${id}/external-label-pdf`,
      form,
    );
  },
  // CP-058 AC-6: staff-only. The portal sends intent; PrepShip (PS-487) owns the rule and
  // may answer 409 when the affected period is finalized and needs DJ approval.
  updateReturnBillingDate: (
    token: RequestAuth,
    id: number,
    body: { newBillingDay: string; reason: string; djApprovalReference?: string | null },
  ) =>
    apiPatch<{ data: { returnId: number; outcome: string; adjustmentPending?: boolean } }>(
      token,
      `/api/client-portal/returns/${id}/billing-date`,
      body,
    ),
  returnsReceiving: (token: RequestAuth, search?: string) =>
    apiGet<{ data: PortalReturnReceivingRow[] }>(token, '/api/client-portal/returns/receiving', {
      search,
    }),
  recordInspection: (token: RequestAuth, id: number, body: NewInspectionInput) =>
    apiPost<{
      data: {
        id: number;
        returnId: number;
        status: string;
        condition: string | null;
        returnStatus: string;
      };
    }>(token, `/api/client-portal/returns/${id}/inspection`, body),
  uploadInspectionMedia: (
    token: RequestAuth,
    id: number,
    inspectionId: number,
    file: File,
    mediaType: 'photo' | 'video',
  ) => {
    const form = new FormData();
    form.set('file', file);
    form.set('mediaType', mediaType);
    if (file.lastModified) form.set('capturedAt', new Date(file.lastModified).toISOString());
    return apiUpload<{ data: { id: number; inspectionId: number; mediaType: string } }>(
      token,
      `/api/client-portal/returns/${id}/inspection/${inspectionId}/media`,
      form,
    );
  },
};
