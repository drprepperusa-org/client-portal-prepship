import type { ListOpts } from '@client-portal-contracts/common';
import type {
  NewInspectionInput,
  NewReturnInput,
  PortalReturnDetail,
  PortalReturnReceivingRow,
  PortalReturnRow,
  ReturnDeliveryResult,
  ReturnLabelResult,
} from '@client-portal-contracts/returns';
import { scopedList } from '../scope';
import { apiGet, apiPost, apiUpload } from '../transport';

export const returnsApi = {
  returns: (token: string, opts: ListOpts & { orderId?: number } = {}) =>
    scopedList<PortalReturnRow>(token, '/api/client-portal/returns', {
      page: opts.page ?? 1,
      pageSize: opts.pageSize ?? 50,
      search: opts.search,
      status: opts.status && opts.status !== 'all' ? opts.status : undefined,
      clientId: opts.clientId,
      orderId: opts.orderId,
    }),
  returnDetail: (token: string, id: number) =>
    apiGet<{ data: PortalReturnDetail }>(token, `/api/client-portal/returns/${id}`),
  createReturn: (token: string, body: NewReturnInput) =>
    apiPost<{ data: { id: number; status: string } }>(token, '/api/client-portal/returns', body),
  createReturnLabel: (token: string, id: number) =>
    apiPost<{ data: ReturnLabelResult }>(token, `/api/client-portal/returns/${id}/label`),
  deliverReturn: (token: string, id: number) =>
    apiPost<{ data: ReturnDeliveryResult }>(token, `/api/client-portal/returns/${id}/deliver`),
  returnsReceiving: (token: string, search?: string) =>
    apiGet<{ data: PortalReturnReceivingRow[] }>(token, '/api/client-portal/returns/receiving', {
      search,
    }),
  recordInspection: (token: string, id: number, body: NewInspectionInput) =>
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
    token: string,
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
