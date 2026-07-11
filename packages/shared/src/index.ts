export type Kobo = number;

export const nairaToKobo = (naira: number): Kobo => {
  return Math.round(naira * 100);
};

export const koboToNaira = (kobo: Kobo): number => {
  return kobo / 100;
};

export * from './church.js';
export * from './schemas.js';
