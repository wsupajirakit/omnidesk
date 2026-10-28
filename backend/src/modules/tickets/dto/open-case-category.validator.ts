/**
 * [FEAT-20261014-TICKETCATS] `category` on open-from-room: one of the ACTIVE provider's
 * ticket categories.
 *
 * Replaces `@IsIn(['Other', 'Payment'])`. A provider that declares nothing (shop-api) gets that
 * very list (`DEFAULT_OPEN_CASE_CATEGORIES`) under the same constraint key `isIn` and the
 * same message class-validator produced — so shop-api's 400 body is byte-identical. loan_v1
 * gets its four (`providers/loan-v1/ticket-categories.ts`).
 * Read at validation time, not decoration time: the provider is bound when the app boots,
 * after this class is defined.
 * revert: delete this file and put `@IsIn(['Other', 'Payment'])` back on the field.
 */
import { registerDecorator, type ValidationOptions } from 'class-validator';

import {
  DEFAULT_OPEN_CASE_CATEGORIES,
  providerTicketCategories,
} from '@/modules/customer-provider';

const allowed = (): readonly string[] =>
  providerTicketCategories() ?? DEFAULT_OPEN_CASE_CATEGORIES;

export function IsOpenCaseCategory(
  options?: ValidationOptions,
): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIn', // same key as @IsIn — the error shape clients see does not move
      target: target.constructor,
      propertyName: String(propertyName),
      options,
      validator: {
        validate: (value: unknown) => allowed().includes(value as string),
        defaultMessage: (args) =>
          `${args?.property ?? 'category'} must be one of the following values: ${allowed().join(', ')}`,
      },
    });
  };
}
