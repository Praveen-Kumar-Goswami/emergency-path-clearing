export const DEFAULT_LAT = parseFloat(import.meta.env.VITE_DEFAULT_LAT ?? '18.623349948572365');
export const DEFAULT_LNG = parseFloat(import.meta.env.VITE_DEFAULT_LNG ?? '73.91231340569654');
export const DEFAULT_CENTER: [number, number] = [DEFAULT_LAT, DEFAULT_LNG];

export const TICK_MS = 3000;
export const LOCATION_MS = 5000;
export const LOOKAHEAD_M = 1000;
export const MOVE_SIDE = 'left';
