/**
 * [FEAT-20261014-TICKETCATS] Which ticket categories a site works with — declared by the
 * customer provider, never by the `acme_category` config row.
 *
 * Owner 14/10/2026: "เอาแค่สี่หมวด Collection IT Payment Other … ห้ามกระทบ x api" and
 * "ต้องไม่อ่านค่านี้ (acme_category) แต่ไปอ่าน customer provider".
 *
 * What the BE already did before this file (unchanged, read 14/10): the assist summary asks
 * the model for `Collection | IT | Other` (summary-prompt.ts) and a payment card locks
 * `Payment` (assist-notification.ts) — so the stored VALUES were always these four. What was
 * missing: a way for the screen to know a site uses them, and the admin "open case from room"
 * route accepted only `Other | Payment`.
 *
 * TARGET: loan_v1 declares the four · the endpoint answers them · open-from-room accepts them.
 * PIN (shop-api): no declaration ⇒ the endpoint answers null (the screen keeps today's code
 *              path) · open-from-room accepts exactly `Other | Payment` with the SAME message
 *              class-validator's `@IsIn` produced.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  bindActiveProvider,
  CUSTOMER_PROVIDER_ENTRIES,
  CustomerProviderController,
  DEFAULT_OPEN_CASE_CATEGORIES,
  providerTicketCategories,
  resetActiveProvider,
  TICKET_CATEGORY_VALUES,
} from '@/modules/customer-provider';
import { OpenTicketFromRoomDto } from '@/modules/tickets';

const byName = (n: string) => {
  const p = CUSTOMER_PROVIDER_ENTRIES.find((e) => e.name === n);
  if (!p) throw new Error('no provider ' + n);
  return p;
};
const loanV1Provider = byName('loan_v1');
const shopapiV1Provider = byName('shopapi_v1');

const ROOM = 'a0d00000000000000000004b';
const errorsFor = async (category: string) =>
  (
    await validate(
      plainToInstance(OpenTicketFromRoomDto, { room_id: ROOM, category }),
    )
  ).flatMap((e) => Object.entries(e.constraints ?? {}));

afterEach(() => resetActiveProvider());

describe('[TICKETCATS] the vocabulary', () => {
  it('⭐ exactly the four values the system writes, in this order', () => {
    expect([...TICKET_CATEGORY_VALUES]).toEqual([
      'Collection',
      'IT',
      'Payment',
      'Other',
    ]);
  });
  it('the fallback for a provider that declares nothing is today’s open-case list', () => {
    expect([...DEFAULT_OPEN_CASE_CATEGORIES]).toEqual(['Other', 'Payment']);
  });
});

describe('[TICKETCATS] loan_v1 declares the four', () => {
  it('⭐ TARGET — bound loan_v1 ⇒ Collection · IT · Payment · Other', () => {
    bindActiveProvider(loanV1Provider);
    expect(providerTicketCategories()).toEqual([
      'Collection',
      'IT',
      'Payment',
      'Other',
    ]);
  });
  it('⭐ PIN — shop-api declares nothing ⇒ null (the screen keeps its own path)', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(providerTicketCategories()).toBeNull();
    resetActiveProvider();
    expect(providerTicketCategories()).toBeNull();
  });
});

describe('[TICKETCATS] GET /api/customer-provider/ticket-categories', () => {
  const ctl = new CustomerProviderController();
  it('⭐ TARGET — loan_v1 ⇒ the four', () => {
    bindActiveProvider(loanV1Provider);
    expect(ctl.ticketCategories()).toEqual({
      success: true,
      data: { ticket_categories: ['Collection', 'IT', 'Payment', 'Other'] },
    });
  });
  it('⭐ PIN — shop-api ⇒ null', () => {
    bindActiveProvider(shopapiV1Provider);
    expect(ctl.ticketCategories()).toEqual({
      success: true,
      data: { ticket_categories: null },
    });
  });
});

describe('[TICKETCATS] POST /api/tickets/open-from-room — category', () => {
  it('⭐ PIN — shop-api accepts exactly Other / Payment', async () => {
    bindActiveProvider(shopapiV1Provider);
    expect(await errorsFor('Other')).toEqual([]);
    expect(await errorsFor('Payment')).toEqual([]);
  });
  it('⭐ PIN — shop-api refuses Collection with the very message @IsIn gave', async () => {
    bindActiveProvider(shopapiV1Provider);
    expect(await errorsFor('Collection')).toEqual([
      ['isIn', 'category must be one of the following values: Other, Payment'],
    ]);
  });
  it('⭐ TARGET — loan_v1 accepts all four', async () => {
    bindActiveProvider(loanV1Provider);
    for (const c of ['Collection', 'IT', 'Payment', 'Other'])
      expect(await errorsFor(c)).toEqual([]);
  });
  it('TARGET — loan_v1 still refuses anything else, naming its own list', async () => {
    bindActiveProvider(loanV1Provider);
    expect(await errorsFor('Loan')).toEqual([
      [
        'isIn',
        'category must be one of the following values: Collection, IT, Payment, Other',
      ],
    ]);
  });
  it('omitted category stays optional', async () => {
    bindActiveProvider(loanV1Provider);
    const errs = await validate(
      plainToInstance(OpenTicketFromRoomDto, { room_id: ROOM }),
    );
    expect(errs).toEqual([]);
  });
});
