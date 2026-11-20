/**
 * The screen sizes every component state is captured at, in CSS pixels.
 * They are common portrait devices and a common laptop screen.
 */
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  tablet: { width: 820, height: 1180 },
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;
