export type HeritageSku = {
  name: string;
  sku: string;
  type: '3-book set' | 'Songbook' | 'Single book';
  notes?: string;
};

export type HeritageBoxRate = {
  box: string;
  fee: number | null;
  sourceLabel?: string;
};

export const HERITAGE_RATE_SHEET = {
  clientName: 'Heritage Kids Press',
  sourceWorkbook: 'Heritage Kids Press Rate Sheet (1).xlsx',
  extractedAt: '2026-05-27',
  prepFee: {
    basePickPack: 2.5,
    additionalUnitFee: 0.5,
    formula: 'Pick & pack = 2.50 + (quantity - 1) * 0.50',
    totalFormula: 'Fulfillment fee = shipping charge + pick/pack fee + box fee + storage fee',
  },
  storage: {
    palletFee: 25,
    cubicFeetPerPallet: 80,
    cubicFootRate: 0.3125,
    formula: 'Storage = cubic feet used * 0.3125, based on $25 per 80 CF pallet',
  },
  receiving: {
    formula: 'Total units = cases * units per case',
    unitSizeFormula: 'Total CF = total units * unit size',
  },
} as const;

export const HERITAGE_BOX_RATES: HeritageBoxRate[] = [
  { box: '11x9x6', fee: 0.74 },
  { box: '12x10x3', fee: 0.67, sourceLabel: 'Workbook formula uses 0.67; later rows include manual 0.55 overrides.' },
  { box: '14x10x8', fee: 0.96 },
  { box: '16x10x13', fee: 1.6 },
  { box: 'Bubble mailer / poly mailer', fee: 0.2 },
  { box: 'As-is / reship / express note rows', fee: null, sourceLabel: 'Workbook marks these as manual/no standard box fee.' },
];

export const HERITAGE_SKUS: HeritageSku[] = [
  { name: 'My First Arabic Words Series', sku: 'arabic-series', type: '3-book set' },
  { name: 'CHINESE - MY FIRST WORD SERIES [SIMPLIFIED]', sku: 'chinese-simplified-series', type: '3-book set' },
  { name: 'My First Chinese Words Series (Traditional)', sku: 'chinese-traditional-series', type: '3-book set' },
  { name: 'KOREAN - FIRST WORD SERIES', sku: 'korean-series', type: '3-book set' },
  { name: 'PORTUGUESE - MY FIRST WORD SERIES', sku: 'portuguese-series', type: '3-book set' },
  { name: 'RUSSIAN - MY FIRST WORD SERIES', sku: 'russian-series', type: '3-book set' },
  { name: 'SPANISH - MY FIRST WORD SERIES', sku: 'spanish-series', type: '3-book set' },
  { name: 'My First Tagalog Words Series', sku: 'tagalog-series', type: '3-book set' },
  { name: 'VIETNAMESE - MY FIRST WORD SERIES', sku: 'vietnamese-series', type: '3-book set' },
  { name: 'My First French Words Series', sku: 'french-series', type: '3-book set', notes: 'Currently out stock. Will be restocked in July.' },
  { name: 'KOREAN SONG BOOK - NURSERY RHYMES', sku: 'korean-songbook-1', type: 'Songbook' },
  { name: 'I Love to Sing in Korean: Animal Songs', sku: 'korean-songbook-2', type: 'Songbook' },
  { name: "I Love to Sing in Korean: Children's Songs", sku: 'korean-songbook-3', type: 'Songbook' },
  { name: 'I Love to Sing in Portuguese: Nursery Rhymes', sku: 'portuguese-songbook-1', type: 'Songbook' },
  { name: 'I Love to Sing in Spanish: Nursery Rhymes', sku: 'spanish-songbook-1', type: 'Songbook' },
  { name: 'I Love to Sing in Spanish: Animal Songs', sku: 'spanish-songbook-2', type: 'Songbook' },
  { name: "I Love to Sing in Spanish: Children's Songs", sku: 'spanish-songbook-3', type: 'Songbook' },
  { name: 'I Love to Sing in Tagalog: Nursery Rhymes', sku: 'tagalog-songbook-1', type: 'Songbook' },
  { name: 'I Love to Sing in Tagalog: Animal Songs', sku: 'tagalog-songbook-2', type: 'Songbook' },
  { name: "I Love to Sing in Tagalog: Children's Songs", sku: 'tagalog-songbook-3', type: 'Songbook' },
  { name: "Joey Books: Children's Songs", sku: 'joey-1-children', type: 'Songbook' },
  { name: 'Joey Books: Animal Songs', sku: 'joey-2-animal', type: 'Songbook' },
  { name: 'Joey Books: Learning Songs', sku: 'joey-3-learning', type: 'Songbook' },
  { name: 'My First 100 Arabic Words', sku: 'arabic-100', type: 'Single book' },
  { name: 'My First Arabic Alphabet', sku: 'arabic-alphabet', type: 'Single book' },
  { name: 'My First Arabic Shapes, Colors, and Numbers', sku: 'arabic-shapes', type: 'Single book' },
  { name: 'My First 100 Korean Words', sku: 'korean-100', type: 'Single book' },
  { name: 'My First Korean Alphabet', sku: 'korean-alphabet', type: 'Single book' },
  { name: 'My First Korean Numbers, Colors, and Shapes', sku: 'korean-shapes', type: 'Single book' },
  { name: 'My First 100 Tagalog Words', sku: 'tagalog-100', type: 'Single book' },
  { name: 'My First Filipino Alphabet', sku: 'tagalog-alphabet', type: 'Single book' },
  { name: 'My First Tagalog Shapes, Colors, and Numbers', sku: 'tagalog-shapes', type: 'Single book' },
  { name: 'My First 100 French Words', sku: 'french-100', type: 'Single book', notes: 'Currently out stock. Will be restocked in July.' },
  { name: 'My First French Alphabet', sku: 'french-alphabet', type: 'Single book' },
  { name: 'My First French Numbers, Shapes, and Colors', sku: 'french-shapes', type: 'Single book' },
  { name: 'My First 100 Portuguese Words', sku: 'portuguese-100', type: 'Single book' },
  { name: 'My First Portuguese Alphabet', sku: 'portuguese-alphabet', type: 'Single book', notes: 'Currently out stock. Will be restocked in July.' },
  { name: 'My First Portuguese Shapes, Colors, and Numbers', sku: 'portuguese-shapes', type: 'Single book', notes: 'Currently out stock. Will be restocked in July.' },
  { name: 'My First 100 Chinese Words (Simplified)', sku: 'chinese-simplified-100', type: 'Single book' },
  { name: 'My First Chinese Characters (Simplified)', sku: 'chinese-simplified-characters', type: 'Single book' },
  { name: 'My First Chinese Shapes, Colors, and Numbers (Simplified)', sku: 'chinese-simplified-shapes', type: 'Single book' },
  { name: 'My First 100 Chinese Words (Traditional)', sku: 'chinese-traditional-100', type: 'Single book', notes: 'Currently out stock.' },
  { name: 'My First Chinese Characters (Traditional)', sku: 'chinese-traditional-characters', type: 'Single book', notes: 'Currently out stock.' },
  { name: 'My First Chinese Shapes, Colors, and Numbers (Traditional)', sku: 'chinese-traditional-shapes', type: 'Single book', notes: 'Currently out stock.' },
  { name: 'My First 100 Vietnamese Words', sku: 'vietnamese-100', type: 'Single book' },
  { name: 'My First Vietnamese Alphabet', sku: 'vietnamese-alphabet', type: 'Single book', notes: "We'll provide these at our next drop-off" },
  { name: 'My First Vietnamese Shapes, Colors, and Numbers', sku: 'vietnamese-shapes', type: 'Single book' },
  { name: 'My First 100 Russian Words', sku: 'russian-100', type: 'Single book' },
  { name: 'My First Russian Alphabet', sku: 'russian-alphabet', type: 'Single book' },
  { name: 'My First Russian Shapes, Colors, and Numbers', sku: 'russian-shapes', type: 'Single book' },
  { name: 'My First 100 Spanish Words', sku: 'spanish-100', type: 'Single book' },
  { name: 'My First Spanish Alphabet', sku: 'spanish-alphabet', type: 'Single book' },
  { name: 'My First Spanish Shapes, Colors, and Numbers', sku: 'spanish-shapes', type: 'Single book' },
];

export function calculateHeritagePickPack(quantity: number) {
  const safeQuantity = Math.max(1, Math.floor(Number.isFinite(quantity) ? quantity : 1));
  return HERITAGE_RATE_SHEET.prepFee.basePickPack + (safeQuantity - 1) * HERITAGE_RATE_SHEET.prepFee.additionalUnitFee;
}

export function calculateHeritageFulfillment(input: {
  quantity: number;
  shippingCharge: number;
  boxFee: number;
  storageFee?: number;
}) {
  const pickPack = calculateHeritagePickPack(input.quantity);
  const shipping = Number.isFinite(input.shippingCharge) ? input.shippingCharge : 0;
  const box = Number.isFinite(input.boxFee) ? input.boxFee : 0;
  const storage = Number.isFinite(input.storageFee ?? 0) ? input.storageFee ?? 0 : 0;
  return {
    pickPack,
    total: shipping + pickPack + box + storage,
  };
}
