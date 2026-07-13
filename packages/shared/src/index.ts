export type Kobo = number;

export const nairaToKobo = (naira: number): Kobo => {
  return Math.round(naira * 100);
};

export const koboToNaira = (kobo: Kobo): number => {
  return kobo / 100;
};

export * from './api.js';
export * from './branch.js';
export * from './church.js';
export * from './region.js';
export * from './schemas.js';
