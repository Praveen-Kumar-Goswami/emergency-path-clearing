export const DEFAULT_LAT = parseFloat(import.meta.env.VITE_DEFAULT_LAT ?? '51.505');
export const DEFAULT_LNG = parseFloat(import.meta.env.VITE_DEFAULT_LNG ?? '-0.09');
export const DEFAULT_CENTER: [number, number] = [DEFAULT_LAT, DEFAULT_LNG];

export const TICK_MS = 3000;
export const LOCATION_MS = 5000;
export const LOOKAHEAD_M = 1000;
export const MOVE_SIDE = 'left';
