import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RADIUS, SPACE, usePalette } from './theme';

interface SnackOptions {
  message: string;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
  /** ms; default 8 seconds so Undo is easy to reach. */
  duration?: number;
}

const SnackContext = createContext<(opts: SnackOptions) => void>(() => undefined);

export function useSnackbar() {
  return useContext(SnackContext);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [snack, setSnack] = useState<SnackOptions | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const c = usePalette();
  const insets = useSafeAreaInsets();

  const show = useCallback((opts: SnackOptions) => {
    if (timer.current) clearTimeout(timer.current);
    setSnack(opts);
    AccessibilityInfo.announceForAccessibility(opts.actionLabel ? `${opts.message}. ${opts.actionLabel} available.` : opts.message);
    timer.current = setTimeout(() => setSnack(null), opts.duration ?? 8000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <SnackContext.Provider value={show}>
      {children}
      {snack ? (
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: SPACE.md, right: SPACE.md, bottom: insets.bottom + 72 }}
        >
          <View
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: c.scheme === 'dark' ? '#F2EDE5' : '#2A2620',
              borderRadius: RADIUS.md,
              paddingVertical: SPACE.sm,
              paddingHorizontal: SPACE.lg,
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACE.md,
              minHeight: 52,
              elevation: 6,
            }}
          >
            <Text style={{ flex: 1, color: c.scheme === 'dark' ? '#1F1B16' : '#FFFFFF', fontSize: 15 }}>{snack.message}</Text>
            {snack.actionLabel && snack.onAction ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={snack.actionLabel}
                hitSlop={10}
                onPress={async () => {
                  const action = snack.onAction;
                  setSnack(null);
                  await action?.();
                }}
                style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: SPACE.sm }}
              >
                <Text style={{ color: c.scheme === 'dark' ? '#2D6A4F' : '#8CCFAE', fontWeight: '800', fontSize: 15 }}>
                  {snack.actionLabel}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </SnackContext.Provider>
  );
}
