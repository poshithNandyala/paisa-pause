import { useColorScheme } from 'react-native';

export interface Palette {
  scheme: 'light' | 'dark';
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  green: string;
  onGreen: string;
  greenSoft: string;
  amber: string;
  amberSoft: string;
  brick: string;
  barTrack: string;
}

/**
 * Calm and readable: warm off-white, dark text, restrained green and amber.
 * No alarming red. Text colours meet WCAG AA contrast on their backgrounds.
 */
export const LIGHT: Palette = {
  scheme: 'light',
  bg: '#FAF7F2',
  card: '#FFFFFF',
  cardAlt: '#F3EEE6',
  text: '#1F1B16',
  muted: '#5E574D',
  border: '#E3DBCF',
  green: '#2D6A4F',
  onGreen: '#FFFFFF',
  greenSoft: '#E4F1EA',
  amber: '#8A5300',
  amberSoft: '#FBEBD0',
  brick: '#9B3A2A',
  barTrack: '#E9E2D6',
};

export const DARK: Palette = {
  scheme: 'dark',
  bg: '#14120F',
  card: '#1E1B17',
  cardAlt: '#28241F',
  text: '#F2EDE5',
  muted: '#B8AFA2',
  border: '#3A342C',
  green: '#8CCFAE',
  onGreen: '#0F2B1F',
  greenSoft: '#1D3428',
  amber: '#F0B85A',
  amberSoft: '#3A2B12',
  brick: '#F0A090',
  barTrack: '#2F2A24',
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? DARK : LIGHT;
}

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const RADIUS = { sm: 8, md: 12, lg: 16 };
export const TOUCH = 48;
