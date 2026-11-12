import { Tabs } from 'expo-router/js-tabs';
import React from 'react';
import { View, type ColorValue } from 'react-native';
import { usePalette } from '../../ui/theme';

/** A simple filled/outlined dot so the active tab doesn't rely on colour alone. */
function TabDot({ focused, color }: { focused: boolean; color: ColorValue }) {
  return (
    <View
      style={{
        width: 10,
        height: 10,
        borderRadius: 5,
        borderWidth: 2,
        borderColor: color,
        backgroundColor: focused ? color : 'transparent',
      }}
    />
  );
}

export default function TabsLayout() {
  const c = usePalette();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.bg },
        headerTintColor: c.text,
        headerTitleStyle: { color: c.text, fontWeight: '700' },
        headerShadowVisible: false,
        tabBarActiveTintColor: c.green,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        tabBarIcon: ({ focused, color }) => <TabDot focused={focused} color={color} />,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarAccessibilityLabel: 'Today' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity', tabBarAccessibilityLabel: 'Activity' }} />
      <Tabs.Screen name="plan" options={{ title: 'Plan', tabBarAccessibilityLabel: 'Plan' }} />
      <Tabs.Screen name="review" options={{ title: 'Review', tabBarAccessibilityLabel: 'Review' }} />
    </Tabs>
  );
}
