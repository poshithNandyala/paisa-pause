import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatPaise, spokenPaise, type FormatOptions, type Paise } from '../domain/money';
import { useStore } from '../state/store';
import { RADIUS, SPACE, TOUCH, usePalette } from './theme';

// ---------------------------------------------------------------------------
// Layout

export function Screen({
  children,
  scroll = true,
  footer,
  noHeader = false,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  footer?: React.ReactNode;
  /** Screens shown without a navigation header need room for the status bar. */
  noHeader?: boolean;
}) {
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const top = noHeader ? insets.top : 0;
  const sampleBanner = <SampleBanner />;
  if (!scroll) {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: top }}>
        {sampleBanner}
        {children}
        {footer ? <View style={{ padding: SPACE.lg, paddingBottom: SPACE.lg + insets.bottom }}>{footer}</View> : null}
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: top }}>
      {sampleBanner}
      <ScrollView
        contentContainerStyle={{ padding: SPACE.lg, paddingBottom: SPACE.xxl + (footer ? 0 : insets.bottom), gap: SPACE.md }}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? (
        <View
          style={{
            padding: SPACE.lg,
            paddingBottom: SPACE.lg + insets.bottom,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            backgroundColor: c.bg,
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

/** Always visible while sample data is open, so it is never mistaken for real records. */
export function SampleBanner() {
  const { storageKind } = useStore();
  const c = usePalette();
  if (storageKind !== 'demo') return null;
  return (
    <View
      accessibilityRole="alert"
      style={{ backgroundColor: c.amberSoft, paddingVertical: SPACE.sm, paddingHorizontal: SPACE.lg }}
    >
      <Text style={{ color: c.amber, fontWeight: '700', fontSize: 14 }}>
        Sample data — not your records. Exit from Settings.
      </Text>
    </View>
  );
}

export function Card({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: 'plain' | 'soft' }) {
  const c = usePalette();
  return (
    <View
      style={[
        {
          backgroundColor: tone === 'soft' ? c.cardAlt : c.card,
          borderRadius: RADIUS.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: c.border,
          padding: SPACE.lg,
          gap: SPACE.sm,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Gap({ size = SPACE.sm }: { size?: number }) {
  return <View style={{ height: size }} />;
}

export function RowWrap({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.sm }, style]}>{children}</View>;
}

export function Divider() {
  const c = usePalette();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginVertical: SPACE.xs }} />;
}

// ---------------------------------------------------------------------------
// Text

type TP = { children: React.ReactNode; style?: StyleProp<TextStyle>; accessibilityLabel?: string; numberOfLines?: number };

export function Title({ children, style }: TP) {
  const c = usePalette();
  return (
    <Text accessibilityRole="header" style={[{ color: c.text, fontSize: 24, fontWeight: '700' }, style]}>
      {children}
    </Text>
  );
}

export function H2({ children, style }: TP) {
  const c = usePalette();
  return (
    <Text accessibilityRole="header" style={[{ color: c.text, fontSize: 18, fontWeight: '700' }, style]}>
      {children}
    </Text>
  );
}

export function Body({ children, style, accessibilityLabel, numberOfLines }: TP) {
  const c = usePalette();
  return (
    <Text
      accessibilityLabel={accessibilityLabel}
      numberOfLines={numberOfLines}
      style={[{ color: c.text, fontSize: 16, lineHeight: 23 }, style]}
    >
      {children}
    </Text>
  );
}

export function Muted({ children, style, accessibilityLabel, numberOfLines }: TP) {
  const c = usePalette();
  return (
    <Text
      accessibilityLabel={accessibilityLabel}
      numberOfLines={numberOfLines}
      style={[{ color: c.muted, fontSize: 14, lineHeight: 20 }, style]}
    >
      {children}
    </Text>
  );
}

export function Label({ children, style }: TP) {
  const c = usePalette();
  return <Text style={[{ color: c.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.3 }, style]}>{children}</Text>;
}

/** An exact amount. Respects "hide amounts". Screen readers hear words. */
export function Money({
  value,
  style,
  options,
  prefix = '',
}: {
  value: Paise;
  style?: StyleProp<TextStyle>;
  options?: FormatOptions;
  prefix?: string;
}) {
  const { snapshot } = useStore();
  const c = usePalette();
  const hidden = snapshot?.settings.hideAmounts ?? false;
  return (
    <Text
      accessibilityLabel={hidden ? 'amount hidden' : `${prefix}${spokenPaise(value)}`}
      style={[{ color: c.text, fontSize: 16, fontVariant: ['tabular-nums'] }, style]}
    >
      {prefix}
      {hidden ? '₹ •••' : formatPaise(value, options)}
    </Text>
  );
}

export function useMoneyText(): (value: Paise, opts?: FormatOptions) => string {
  const { snapshot } = useStore();
  const hidden = snapshot?.settings.hideAmounts ?? false;
  return (value, opts) => (hidden ? '₹ •••' : formatPaise(value, opts));
}

// ---------------------------------------------------------------------------
// Controls

export type ButtonKind = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  hint,
  style,
  compact,
}: {
  label: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const c = usePalette();
  const bg = kind === 'primary' ? c.green : kind === 'secondary' ? c.card : 'transparent';
  const fg = kind === 'primary' ? c.onGreen : kind === 'danger' ? c.brick : c.green;
  const border = kind === 'secondary' ? c.green : kind === 'danger' ? c.brick : 'transparent';
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!inactive, busy: !!busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: TOUCH,
          paddingHorizontal: compact ? SPACE.md : SPACE.lg,
          paddingVertical: SPACE.sm,
          borderRadius: RADIUS.md,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' || kind === 'danger' ? 1.5 : 0,
          borderColor: border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
          flexDirection: 'row',
          gap: SPACE.sm,
        },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
    </Pressable>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  role = 'radio',
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  role?: 'radio' | 'checkbox' | 'button';
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityState={role === 'button' ? undefined : role === 'checkbox' ? { checked: !!selected } : { selected: !!selected }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        minHeight: 40,
        paddingHorizontal: SPACE.md,
        borderRadius: 20,
        borderWidth: 1.5,
        borderColor: selected ? c.green : c.border,
        backgroundColor: selected ? c.greenSoft : c.card,
        justifyContent: 'center',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: selected ? c.green : c.text, fontSize: 15, fontWeight: selected ? '700' : '500' }}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: SPACE.xs }}>
      {label ? <Label>{label}</Label> : null}
      <RowWrap>
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} />
        ))}
      </RowWrap>
    </View>
  );
}

export function Field({
  label,
  error,
  help,
  ...input
}: TextInputProps & { label: string; error?: string | null; help?: string }) {
  const c = usePalette();
  return (
    <View style={{ gap: SPACE.xs }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        {...input}
        style={[
          {
            minHeight: TOUCH,
            borderWidth: 1.5,
            borderColor: error ? c.amber : c.border,
            borderRadius: RADIUS.md,
            paddingHorizontal: SPACE.md,
            paddingVertical: SPACE.sm,
            color: c.text,
            backgroundColor: c.card,
            fontSize: 16,
          },
          input.multiline ? { minHeight: 88, textAlignVertical: 'top' } : null,
          input.style,
        ]}
      />
      {help ? <Muted>{help}</Muted> : null}
      {error ? <Text style={{ color: c.amber, fontSize: 14, fontWeight: '600' }}>⚠ {error}</Text> : null}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
      onPress={() => onChange(!value)}
      style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.md, minHeight: TOUCH }}
    >
      <View style={{ flex: 1 }}>
        <Body>{label}</Body>
        {description ? <Muted>{description}</Muted> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: c.green, false: c.barTrack }}
        thumbColor={c.card}
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

export function LinkRow({
  label,
  detail,
  onPress,
  right,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  right?: React.ReactNode;
}) {
  const c = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}. ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH,
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACE.md,
        paddingVertical: SPACE.sm,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View style={{ flex: 1 }}>
        <Body style={{ fontWeight: '600' }}>{label}</Body>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      {right}
      <Text style={{ color: c.muted, fontSize: 20 }} importantForAccessibility="no">
        ›
      </Text>
    </Pressable>
  );
}

export function KeyValue({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: SPACE.md, minHeight: 28 }}>
      <Muted style={strong ? { fontWeight: '700' } : undefined}>{label}</Muted>
      {typeof value === 'string' ? <Body style={strong ? { fontWeight: '700' } : undefined}>{value}</Body> : value}
    </View>
  );
}

export function Banner({
  tone = 'info',
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone?: 'info' | 'warn' | 'good';
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const c = usePalette();
  const bg = tone === 'warn' ? c.amberSoft : tone === 'good' ? c.greenSoft : c.cardAlt;
  const fg = tone === 'warn' ? c.amber : tone === 'good' ? c.green : c.text;
  const icon = tone === 'warn' ? '⚠' : tone === 'good' ? '✓' : 'ℹ';
  return (
    <View style={{ backgroundColor: bg, borderRadius: RADIUS.md, padding: SPACE.md, gap: SPACE.xs }}>
      <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>
        {icon} {title}
      </Text>
      {body ? <Text style={{ color: c.text, fontSize: 14, lineHeight: 20 }}>{body}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={{ minHeight: 36, justifyContent: 'center' }}>
          <Text style={{ color: fg, fontWeight: '700', fontSize: 15, textDecorationLine: 'underline' }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Card tone="soft" style={{ alignItems: 'flex-start' }}>
      <Body style={{ fontWeight: '700' }}>{title}</Body>
      <Muted>{body}</Muted>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} kind="secondary" compact /> : null}
    </Card>
  );
}

/** A plain progress bar. The text next to it carries the meaning, not the colour. */
export function Bar({ used, total, label }: { used: number; total: number; label: string }) {
  const c = usePalette();
  const ratio = total > 0 ? Math.max(0, used / total) : used > 0 ? 1 : 0;
  const over = used > total;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.min(100, Math.round(ratio * 100)) }}
      style={{ height: 10, borderRadius: 5, backgroundColor: c.barTrack, overflow: 'hidden' }}
    >
      <View
        style={{
          width: `${Math.min(100, ratio * 100)}%`,
          height: '100%',
          backgroundColor: over ? c.amber : c.green,
          borderRadius: 5,
        }}
      />
    </View>
  );
}

export function Pill({ text, tone = 'neutral' }: { text: string; tone?: 'neutral' | 'warn' | 'good' }) {
  const c = usePalette();
  const bg = tone === 'warn' ? c.amberSoft : tone === 'good' ? c.greenSoft : c.cardAlt;
  const fg = tone === 'warn' ? c.amber : tone === 'good' ? c.green : c.muted;
  return (
    <View style={{ backgroundColor: bg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{text}</Text>
    </View>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  const c = usePalette();
  if (!children) return null;
  return (
    <Text accessibilityRole="alert" style={{ color: c.amber, fontSize: 15, fontWeight: '600' }}>
      ⚠ {children}
    </Text>
  );
}
