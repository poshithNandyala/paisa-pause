import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, type StyleProp, type TextStyle } from 'react-native';
import { formatPaise, spokenPaise, type Paise } from '../domain/money';
import { useStore } from '../state/store';

/** True when the phone asks for reduced motion, or the app setting says so. */
export function useReducedMotion(): boolean {
  const { snapshot } = useStore();
  const setting = snapshot?.settings.motion ?? 'system';
  const [system, setSystem] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => mounted && setSystem(v))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setSystem(v));
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  if (setting === 'reduce') return true;
  if (setting === 'full') return false;
  return system;
}

/** Suggested 200–400 ms; a product default to validate, not a proven number. */
export const SPEND_TRANSITION_MS = 300;

/**
 * Shows an exact amount. When it changes, it moves to the new value over a
 * short, interruptible transition. The final number is always exact, and
 * nothing waits for the animation.
 */
export function AnimatedMoney({ value, style }: { value: Paise; style?: StyleProp<TextStyle> }) {
  const reduced = useReducedMotion();
  const { snapshot } = useStore();
  const hidden = snapshot?.settings.hideAmounts ?? false;
  const instant = reduced || hidden;
  const [anim] = useState(() => new Animated.Value(value));
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const id = anim.addListener(({ value: v }) => setShown(Math.round(v)));
    return () => anim.removeListener(id);
  }, [anim]);

  useEffect(() => {
    // Interrupt any running transition and head for the new exact value.
    anim.stopAnimation();
    if (instant) {
      anim.setValue(value);
      return;
    }
    Animated.timing(anim, {
      toValue: value,
      duration: SPEND_TRANSITION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [value, instant, anim]);

  // With reduced motion (or hidden amounts) the exact value shows at once.
  const display = instant ? value : shown;
  return (
    <Text accessibilityLabel={hidden ? 'amount hidden' : spokenPaise(value)} style={style}>
      {hidden ? '₹ •••' : formatPaise(display)}
    </Text>
  );
}
