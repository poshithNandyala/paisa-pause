// Render tests run without a phone: keep motion instant and quiet noisy logs.
jest.mock('react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo', () => {
  const actual = jest.requireActual('react-native/Libraries/Components/AccessibilityInfo/AccessibilityInfo');
  const mod = actual.default ?? actual;
  mod.isReduceMotionEnabled = () => Promise.resolve(true);
  mod.announceForAccessibility = () => undefined;
  return actual;
});
