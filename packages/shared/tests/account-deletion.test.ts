import { describe, expect, it } from 'vitest';

import { ACCOUNT_DELETION_MESSAGES, deleteAccountSchema } from '../src';

describe('deleting an account', () => {
  it('needs the password and an explicit yes', () => {
    expect(deleteAccountSchema.safeParse({ password: 'secret-pass', confirm: true }).success).toBe(
      true,
    );
    const noYes = deleteAccountSchema.safeParse({ password: 'secret-pass', confirm: false });
    expect(noYes.error?.issues[0]?.message).toBe(ACCOUNT_DELETION_MESSAGES.confirmRequired);
    const noPassword = deleteAccountSchema.safeParse({ password: '', confirm: true });
    expect(noPassword.error?.issues[0]?.message).toBe(ACCOUNT_DELETION_MESSAGES.passwordRequired);
  });

  it('takes nothing that would name another account', () => {
    expect(
      deleteAccountSchema.safeParse({
        password: 'secret-pass',
        confirm: true,
        farmer_id: '7a1b2c3d-0000-4000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});
