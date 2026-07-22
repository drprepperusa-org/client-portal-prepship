export type ReturnLabelExecutionMode = 'live' | 'test_offline' | 'disabled';

/**
 * Test clients may receive an explicit offline fixture. Real clients either
 * use the approved live path or fail closed; a disabled live flag must never
 * manufacture a customer-visible tracking number or label.
 */
export function resolveReturnLabelExecutionMode(input: {
  liveLabelsEnabled: boolean;
  isTestClient: boolean;
}): ReturnLabelExecutionMode {
  if (input.isTestClient) return 'test_offline';
  return input.liveLabelsEnabled ? 'live' : 'disabled';
}
