import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { SPACE, usePalette } from './theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];

/**
 * Amount keypad. Edits a plain string like "199.5"; at most 2 decimals and
 * 10 rupee digits, so the value always parses to exact paise.
 */
export function applyKey(current: string, key: string): string {
  if (key === '⌫') return current.slice(0, -1);
  if (key === '.') {
    if (current.includes('.')) return current;
    return current === '' ? '0.' : `${current}.`;
  }
  const [whole, frac] = current.split('.');
  if (frac !== undefined) {
    if (frac.length >= 2) return current;
    return `${current}${key}`;
  }
  if (whole === '0') return key;
  if (whole.length >= 10) return current;
  return `${current}${key}`;
}

export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const c = usePalette();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }}>
      {KEYS.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === '⌫' ? 'Delete last digit' : k === '.' ? 'Decimal point' : k}
          onPress={() => onChange(applyKey(value, k))}
          onLongPress={k === '⌫' ? () => onChange('') : undefined}
          style={({ pressed }) => ({
            width: '31.5%',
            minHeight: 56,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? c.greenSoft : c.card,
            borderWidth: 1,
            borderColor: c.border,
          })}
        >
          <Text style={{ color: c.text, fontSize: 24, fontWeight: '600' }}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
}
