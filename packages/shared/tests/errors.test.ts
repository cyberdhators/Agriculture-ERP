import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  ERROR_CODES,
  ERROR_MESSAGES,
  apiError,
  phoneSchema,
  zodErrorToApiError,
} from '../src/index';

/**
 * Phone numbers here are FABRICATED. See phone.test.ts.
 */

/** A shape with a nested object and a list, so field naming can be checked. */
const farmerSchema = z.strictObject({
  name: z.string({ error: () => 'Enter a name.' }).min(1, 'Enter a name.'),
  phone: phoneSchema,
  farm: z.strictObject({
    area: z.number({ error: () => 'Enter the area in hectares.' }),
  }),
  plots: z.array(z.strictObject({ name: z.string({ error: () => 'Enter a plot name.' }) })),
});

const failureFrom = (input: unknown) => {
  const result = farmerSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('unreachable');
  return zodErrorToApiError(result.error);
};

const validFarmer = {
  name: 'Fabricated Name',
  phone: '+211912345678',
  farm: { area: 2.5 },
  plots: [{ name: 'North plot' }],
};

describe('turning a validation failure into the error a client sees', () => {
  it('reports one bad field with the reason under that field name', () => {
    const { status, body } = failureFrom({ ...validFarmer, phone: 'not a number' });

    expect(status).toBe(400);
    expect(body.error.code).toBe(ERROR_CODES.invalidInput);
    expect(body.error.message).toBe(ERROR_MESSAGES.invalidInput);
    expect(body.error.fields).toEqual({ phone: 'A mobile number contains digits only.' });
  });

  it('reports every bad field when more than one is wrong', () => {
    const { body } = failureFrom({ ...validFarmer, name: '', phone: '+254712345678' });

    expect(Object.keys(body.error.fields ?? {}).sort()).toEqual(['name', 'phone']);
  });

  it('names a field inside a nested section using a dot', () => {
    const { body } = failureFrom({ ...validFarmer, farm: { area: 'big' } });

    expect(body.error.fields).toEqual({ 'farm.area': 'Enter the area in hectares.' });
  });

  it('names a field inside a list using its position', () => {
    const { body } = failureFrom({ ...validFarmer, plots: [{ name: 'North plot' }, { name: 7 }] });

    expect(body.error.fields).toEqual({ 'plots.1.name': 'Enter a plot name.' });
  });

  it('names a field that the request is not allowed to send', () => {
    const { body } = failureFrom({ ...validFarmer, nickname: 'Bibi' });

    expect(body.error.fields).toEqual({ nickname: ERROR_MESSAGES.unknownField });
  });

  it('names an unrecognised field inside a nested section', () => {
    const { body } = failureFrom({ ...validFarmer, farm: { area: 2.5, colour: 'green' } });

    expect(body.error.fields).toEqual({ 'farm.colour': ERROR_MESSAGES.unknownField });
  });

  it('gives one sentence per field even when a field breaks several rules', () => {
    const { body } = failureFrom({ ...validFarmer, name: '' });
    const reasons = Object.values(body.error.fields ?? {});

    expect(reasons).toHaveLength(1);
    expect(typeof reasons[0]).toBe('string');
  });

  it('says the body itself was wrong when nothing usable was sent', () => {
    const result = farmerSchema.safeParse('a plain sentence, not a form');
    expect(result.success).toBe(false);
    if (result.success) throw new Error('unreachable');

    expect(Object.keys(zodErrorToApiError(result.error).body.error.fields ?? {})).toEqual(['body']);
  });
});

describe('errors that are not about a particular field', () => {
  it('carries no field list at all', () => {
    const body = apiError(ERROR_CODES.invalidJson, ERROR_MESSAGES.invalidJson);

    expect(body).toEqual({
      error: { code: 'invalid_json', message: 'The request body could not be read.' },
    });
    expect('fields' in body.error).toBe(false);
  });

  it('always gives the same sentence for an unexpected failure', () => {
    expect(ERROR_MESSAGES.internalError).toBe('Something went wrong. Please try again.');
  });
});
