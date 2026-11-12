import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import type { LocalDate } from '../domain/dates';
import {
  addDays,
  addMonthsClamped,
  daysInMonth,
  formatDateShort,
  makeDate,
  monthName,
  parts,
  weekday,
  weekdayName,
} from '../domain/dates';
import { Button, Chip, RowWrap } from './kit';
import { RADIUS, SPACE, usePalette } from './theme';

/** Today / Yesterday chips plus a small calendar. Future dates can't be picked for real entries. */
export function DateField({
  value,
  today,
  onChange,
  allowFuture = false,
}: {
  value: LocalDate;
  today: LocalDate;
  onChange: (d: LocalDate) => void;
  allowFuture?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const yesterday = addDays(today, -1);
  const custom = value !== today && value !== yesterday;
  return (
    <View style={{ gap: SPACE.xs }}>
      <RowWrap>
        <Chip label="Today" selected={value === today} onPress={() => onChange(today)} />
        <Chip label="Yesterday" selected={value === yesterday} onPress={() => onChange(yesterday)} />
        <Chip label={custom ? formatDateShort(value) : 'Pick a date'} selected={custom} onPress={() => setOpen(true)} />
      </RowWrap>
      <CalendarModal
        visible={open}
        value={value}
        max={allowFuture ? null : today}
        onClose={() => setOpen(false)}
        onPick={(d) => {
          onChange(d);
          setOpen(false);
        }}
      />
    </View>
  );
}

export function CalendarModal({
  visible,
  value,
  max,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: LocalDate;
  max: LocalDate | null;
  onPick: (d: LocalDate) => void;
  onClose: () => void;
}) {
  const c = usePalette();
  const [month, setMonth] = useState(() => makeDate(parts(value).y, parts(value).m, 1));
  const { y, m } = parts(month);
  const first = makeDate(y, m, 1);
  // Monday-first grid
  const lead = (weekday(first) + 6) % 7;
  const cells: (LocalDate | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push(makeDate(y, m, d));
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: SPACE.lg }}>
        <View style={{ backgroundColor: c.card, borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Button label="‹ Prev" kind="quiet" compact onPress={() => setMonth(addMonthsClamped(month, -1, 1))} />
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, fontWeight: '700' }}>
              {monthName(m, true)} {y}
            </Text>
            <Button
              label="Next ›"
              kind="quiet"
              compact
              disabled={max !== null && addMonthsClamped(month, 1, 1) > max}
              onPress={() => setMonth(addMonthsClamped(month, 1, 1))}
            />
          </View>
          <View style={{ flexDirection: 'row' }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <Text key={i} importantForAccessibility="no" style={{ flex: 1, textAlign: 'center', color: c.muted, fontWeight: '600' }}>
                {d}
              </Text>
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={{ width: `${100 / 7}%`, height: 44 }} />;
              const disabled = max !== null && d > max;
              const selected = d === value;
              return (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  accessibilityLabel={`${weekdayName(d, true)} ${parts(d).d} ${monthName(parts(d).m, true)}`}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => onPick(d)}
                  style={{
                    width: `${100 / 7}%`,
                    height: 44,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 22,
                    backgroundColor: selected ? c.green : 'transparent',
                    opacity: disabled ? 0.3 : 1,
                  }}
                >
                  <Text style={{ color: selected ? c.onGreen : c.text, fontSize: 16, fontWeight: selected ? '700' : '400' }}>
                    {parts(d).d}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button label="Close" kind="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
