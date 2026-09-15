import { parseSouthSudanMobile } from '@agri-erp/shared';

/** What a buyer gives at the moment of interest. No account: this IS their identity, checked by the officer's call. */
export interface ContactRequestInput {
  buyer_name: string;
  buyer_phone: string;
  message: string;
  quantity: string;
}

export interface ContactRequestBody {
  buyer_name: string;
  buyer_phone: string;
  message: string | null;
  quantity: string | null;
}

export type ContactRequestErrors = Partial<Record<keyof ContactRequestInput, string>>;

export const CONTACT_LIMITS = { nameMax: 80, messageMax: 300, quantityMax: 40 } as const;

/** The same rules the route will run; returned as sentences the form shows beside the field. */
export function validateContactRequest(
  input: ContactRequestInput,
): { ok: true; body: ContactRequestBody } | { ok: false; errors: ContactRequestErrors } {
  const errors: ContactRequestErrors = {};
  const name = input.buyer_name.trim();
  if (name.length < 2) errors.buyer_name = 'Enter your name, so the officer knows who is calling.';
  else if (name.length > CONTACT_LIMITS.nameMax) errors.buyer_name = 'That name is too long.';
  const phone = parseSouthSudanMobile(input.buyer_phone);
  if (!phone.ok) errors.buyer_phone = phone.message;
  const message = input.message.trim();
  if (message.length > CONTACT_LIMITS.messageMax)
    errors.message = `Keep the message under ${CONTACT_LIMITS.messageMax} characters.`;
  const quantity = input.quantity.trim();
  if (quantity.length > CONTACT_LIMITS.quantityMax) errors.quantity = 'Keep the quantity short.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    body: {
      buyer_name: name,
      buyer_phone: phone.ok ? phone.value : input.buyer_phone,
      message: message === '' ? null : message,
      quantity: quantity === '' ? null : quantity,
    },
  };
}
