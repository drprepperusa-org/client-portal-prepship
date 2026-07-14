import { Hono } from 'hono';
import { verifyMockLabelSignature } from '../lib/mock-label-access';
import { generateMockLabelHtml } from '../services/mock-label-generator';
import { getMockLabel, getMockLabelAsync } from '../services/mock-label-store';

const app = new Hono();

// Signed download endpoint kept separate so portal-only deployments do not
// need to expose the rest of the operational /labels API.
app.get('/:shipmentId', async (c) => {
  const param = c.req.param('shipmentId');
  if (!/^-?\d+$/.test(param)) {
    return c.json({ error: 'Not found' }, 404);
  }
  const shipmentId = Number(param);
  if (!verifyMockLabelSignature(shipmentId, c.req.query('exp'), c.req.query('sig'))) {
    return c.json({ error: 'Mock label link expired' }, 403);
  }

  const data = getMockLabel(shipmentId) ?? await getMockLabelAsync(shipmentId);
  if (!data) {
    return c.text('Mock label not found', 404, { 'content-type': 'text/plain' });
  }
  if (data.pdfBase64) {
    const pdfBytes = Buffer.from(data.pdfBase64, 'base64');
    return new Response(pdfBytes, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `inline; filename="mock-label-${shipmentId}.pdf"`,
        'content-length': String(pdfBytes.byteLength),
      },
    });
  }

  return new Response(generateMockLabelHtml(data), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});

export default app;
