/**
 * Central bank registry — code → nice_name / thai_name / color / logo.
 *
 * Ported from legacy `src/config/bankDirectory.js`. It is the same table the
 * webhook reads when substituting `{{bank_code}}` into a card, which is why
 * `GET /api/banks` serves it verbatim rather than the frontend keeping a copy:
 * a second copy drifts, and the drift shows up as a wrong bank name on a card
 * a customer is looking at.
 *
 * Keys are always lowercase; callers sending "BBL" / " bbl " are normalised by
 * `normalizeBankKey`. An unknown code returns null (or the original string from
 * `resolveBankNiceName`) — never empty, never a throw.
 *
 * `logo` is a path relative to the backend's static root, so the caller adds
 * its own host. In legacy it is attached by a loop over BANK_LOGO_KEYS after
 * the table literal; here the resolved value is inlined, so the served payload
 * is byte-identical without a second construction step that could diverge.
 *
 * ⚠️ Adding or editing a bank happens here only.
 */

/** One bank's public record. `logo` is absent for banks without an asset. */
export interface BankInfo {
  code: string;
  color: string;
  official_name: string;
  thai_name: string;
  nice_name: string;
  logo?: string;
}

/**
 * Coerce an untrusted value to a string without ever producing
 * "[object Object]".
 *
 * These functions take whatever arrived on the wire, and a bare `String(v)` on
 * an object yields a placeholder that then travels into an error message the
 * admin has to act on. Anything non-primitive becomes '' instead, which every
 * caller here already treats as "absent".
 */
function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  // null, undefined, objects, arrays, symbols and functions all read as absent.
  return '';
}

export const DEFAULT_COUNTRY = 'th';

/** Static path prefix for bank logo assets, relative to the static root. */
export const BANK_LOGO_BASE = '/bank-logos';

export const BANK_DIRECTORY: Record<string, Record<string, BankInfo>> = {
  th: {
    bbl: {
      code: '002',
      color: '#1e4598',
      official_name: 'BANGKOK BANK PUBLIC COMPANY LTD.',
      thai_name: 'ธนาคารกรุงเทพ',
      nice_name: 'Bangkok Bank',
      logo: '/bank-logos/bbl.png',
    },
    kbank: {
      code: '004',
      color: '#138f2d',
      official_name: 'KASIKORNBANK PUBLIC COMPANY LTD.',
      thai_name: 'ธนาคารกสิกรไทย',
      nice_name: 'Kasikornbank',
      logo: '/bank-logos/kbank.png',
    },
    rbs: {
      code: '005',
      color: '#032952',
      official_name: 'THE ROYAL BANK OF SCOTLAND PLC',
      thai_name: 'ธนาคาร เดอะรอยัลแบงค์อ๊อฟสกอตแลนด์',
      nice_name: 'Royal Bank of Scotland',
    },
    ktb: {
      code: '006',
      color: '#1ba5e1',
      official_name: 'KRUNG THAI BANK PUBLIC COMPANY LTD.',
      thai_name: 'ธนาคารกรุงไทย',
      nice_name: 'Krungthai Bank',
      logo: '/bank-logos/ktb.png',
    },
    jpm: {
      code: '008',
      color: '#321c10',
      official_name: 'JPMORGAN CHASE BANK, NATIONAL ASSOCIATION',
      thai_name: 'เจพีมอร์แกนเชส',
      nice_name: 'J.P. Morgan',
    },
    mufg: {
      code: '010',
      color: '#d61323',
      official_name: 'THE BANK OF TOKYO-MITSUBISHI UFJ, LTD.',
      thai_name: 'ธนาคารแห่งโตเกียว-มิตซูบิชิ ยูเอฟเจ',
      nice_name: 'Bank of Tokyo-Mitsubishi UFJ',
    },
    tmb: {
      code: '011',
      color: '#1279be',
      official_name: 'TMB BANK PUBLIC COMPANY LIMITED.',
      thai_name: 'ธนาคารทหารไทย',
      nice_name: 'TMB Bank',
    },
    scb: {
      code: '014',
      color: '#4e2e7f',
      official_name: 'SIAM COMMERCIAL BANK PUBLIC COMPANY LTD.',
      thai_name: 'ธนาคารไทยพาณิชย์',
      nice_name: 'Siam Commercial Bank',
      logo: '/bank-logos/scb.png',
    },
    citi: {
      code: '017',
      color: '#1583c7',
      official_name: 'CITIBANK, N.A.',
      thai_name: 'ธนาคารซิตี้แบงค์',
      nice_name: 'Citibank',
      logo: '/bank-logos/citi.png',
    },
    smbc: {
      code: '018',
      color: '#a0d235',
      official_name: 'SUMITOMO MITSUI BANKING CORPORATION',
      thai_name: 'ธนาคารซูมิโตโม มิตซุย แบงค์กิ้ง คอร์ปอเรชั่น',
      nice_name: 'Sumitomo Mitsui Banking Corporation',
    },
    sc: {
      code: '020',
      color: '#0f6ea1',
      official_name: 'STANDARD CHARTERED BANK (THAI) PUBLIC COMPANY LIMITED',
      thai_name: 'สแตนดาร์ดชาร์เตอร์ด ประเทศไทย',
      nice_name: 'Standard Chartered (Thai)',
    },
    cimb: {
      code: '022',
      color: '#7e2f36',
      official_name: 'CIMB THAI BANK PUPBLIC COMPANY LTD.',
      thai_name: 'ธนาคารซีไอเอ็มบีไทย',
      nice_name: 'CIMB Thai Bank',
      logo: '/bank-logos/cimb.png',
    },
    uob: {
      code: '024',
      color: '#0b3979',
      official_name: 'UNITED OVERSEAS BANK (THAI) PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารยูโอบี',
      nice_name: 'United Overseas Bank (Thai)',
      logo: '/bank-logos/uob.png',
    },
    bay: {
      code: '025',
      color: '#fec43b',
      official_name: 'BANK OF AYUDHYA PUBLIC COMPANY LTD.',
      thai_name: 'ธนาคารกรุงศรีอยุธยา',
      nice_name: 'Bank of Ayudhya (Krungsri)',
      logo: '/bank-logos/bay.png',
    },
    mega: {
      code: '026',
      color: '#815e3b',
      official_name:
        'MEGA INTERNATIONAL COMMERCIAL BANK PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคาร เมกะ สากลพาณิชย์',
      nice_name: 'Mega International Commercial Bank',
    },
    boa: {
      code: '027',
      color: '#e11e3c',
      official_name: 'BANK OF AMERICA, NATIONAL ASSOCIATION',
      thai_name: 'แบงก์ออฟอเมริกาคอร์ปอเรชั่น',
      nice_name: 'Bank of America',
    },
    cacib: {
      code: '028',
      color: '#0e765b',
      official_name: 'CREDIT AGRICOLE CORPORATE AND INVESTMENT BANK',
      thai_name: 'ธนาคารเครดิต อะกริโคล',
      nice_name: 'Crédit Agricole',
    },
    gsb: {
      code: '030',
      color: '#eb198d',
      official_name: 'THE GOVERNMENT SAVINGS BANK',
      thai_name: 'ธนาคารออมสิน',
      nice_name: 'Government Savings Bank',
      logo: '/bank-logos/gsb.png',
    },
    hsbc: {
      code: '031',
      color: '#fd0d1b',
      official_name: 'THE HONGKONG AND SHANGHAI BANKING CORPORATION LTD.',
      thai_name: 'ฮ่องกงและเซี่ยงไฮ้แบงกิ้งคอร์ปอเรชั่น',
      nice_name: 'Hongkong and Shanghai Banking Corporation',
      logo: '/bank-logos/hsbc.png',
    },
    db: {
      code: '032',
      color: '#0522a5',
      official_name: 'DEUTSCHE BANK AG.',
      thai_name: 'ธนาคารดอยช์แบงก์',
      nice_name: 'Deutsche Bank',
    },
    ghb: {
      code: '033',
      color: '#f57d23',
      official_name: 'THE GOVERNMENT HOUSING BANK',
      thai_name: 'ธนาคารอาคารสงเคราะห์',
      nice_name: 'Government Housing Bank',
      logo: '/bank-logos/ghb.png',
    },
    baac: {
      code: '034',
      color: '#4b9b1d',
      official_name: 'BANK FOR AGRICULTURE AND AGRICULTURAL COOPERATIVES',
      thai_name: 'ธนาคารเพื่อการเกษตรและสหกรณ์การเกษตร',
      nice_name: 'Bank for Agriculture and Agricultural Cooperatives',
      logo: '/bank-logos/baac.png',
    },
    mb: {
      code: '039',
      color: '#150b78',
      official_name: 'MIZUHO BANK, LTD.',
      thai_name: 'ธนาคารมิซูโฮ',
      nice_name: 'Mizuho Bank',
    },
    bnp: {
      code: '045',
      color: '#14925e',
      official_name: 'BNP PARIBAS',
      thai_name: 'บีเอ็นพี พารีบาส์',
      nice_name: 'BNP Paribas',
    },
    tbank: {
      code: '065',
      color: '#fc4f1f',
      official_name: 'THANACHART BANK PUBLIC COMPANY LTD.',
      thai_name: 'ธนาคารธนชาต',
      nice_name: 'Thanachart Bank',
    },
    ibank: {
      code: '066',
      color: '#184615',
      official_name: 'ISLAMIC BANK OF THAILAND',
      thai_name: 'ธนาคารอิสลามแห่งประเทศไทย',
      nice_name: 'Islamic Bank of Thailand',
      logo: '/bank-logos/ibank.png',
    },
    tisco: {
      code: '067',
      color: '#12549f',
      official_name: 'TISCO BANK PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารทิสโก้',
      nice_name: 'Tisco Bank',
      logo: '/bank-logos/tisco.png',
    },
    kk: {
      code: '069',
      color: '#199cc5',
      official_name: 'KIATNAKIN BANK PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารเกียรตินาคินภัทร',
      nice_name: 'Kiatnakin Bank',
      logo: '/bank-logos/kk.png',
    },
    icbc: {
      code: '070',
      color: '#c50f1c',
      official_name:
        'INDUSTRIAL AND COMMERCIAL BANK OF CHINA (THAI) PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารสินเอเซีย จำกัด (มหาชน)',
      nice_name: 'Industrial and Commercial Bank of China (Thai)',
      logo: '/bank-logos/icbc.png',
    },
    tcrb: {
      code: '071',
      color: '#0a4ab3',
      official_name: 'THE THAI CREDIT RETAIL BANK PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารไทยเครดิต เพื่อรายย่อย',
      nice_name: 'Thai Credit Retail Bank',
      logo: '/bank-logos/tcrb.png',
    },
    lhb: {
      code: '073',
      color: '#6d6e71',
      official_name: 'LAND AND HOUSES BANK PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารแลนด์ แอนด์ เฮ้าส์',
      nice_name: 'Land and Houses Bank',
      logo: '/bank-logos/lhb.png',
    },
    tmn: {
      code: '074',
      color: '#ecf0f1',
      official_name: 'TRUE MONEY WALLET',
      thai_name: 'ทรูมันนี่ วอลเล็ท',
      nice_name: 'TrueMoney Wallet',
      logo: '/bank-logos/tmn.png',
    },
    pp: {
      code: '075',
      color: '#00427a',
      official_name: 'PROMPTPAY',
      thai_name: 'พร้อมเพย์',
      nice_name: 'PromptPay',
      logo: '/bank-logos/pp.png',
    },
    ttb: {
      code: '076',
      color: '#ecf0f1',
      official_name: 'TMBTHANACHART BANK PUBLIC COMPANY LIMITED',
      thai_name: 'ธนาคารทหารไทยธนชาต',
      nice_name: 'TMBThanachart Bank',
      logo: '/bank-logos/ttb.png',
    },
  },
};

/** code → table key: trimmed and lowercased, so "BBL" and " bbl " both resolve. */
export function normalizeBankKey(code: unknown): string {
  return safeString(code).trim().toLowerCase();
}

/** The whole record for a bank, or null when the code is unknown. */
export function getBankInfo(
  code: unknown,
  country: string = DEFAULT_COUNTRY,
): BankInfo | null {
  const table = BANK_DIRECTORY[country] ?? {};
  return table[normalizeBankKey(code)] ?? null;
}

/**
 * Display name for a bank code.
 *
 * An unrecognised code returns the trimmed original rather than an empty
 * string: this feeds card text, and a blank reads as a broken card while the
 * raw code at least reads as data.
 */
export function resolveBankNiceName(
  code: unknown,
  country: string = DEFAULT_COUNTRY,
): string {
  const info = getBankInfo(code, country);
  if (info?.nice_name) return info.nice_name;
  return safeString(code).trim();
}

/** Relative logo path, or null when the bank has no asset. */
export function resolveBankLogo(
  code: unknown,
  country: string = DEFAULT_COUNTRY,
): string | null {
  return getBankInfo(code, country)?.logo ?? null;
}
