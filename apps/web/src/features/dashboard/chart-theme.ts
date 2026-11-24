/* Shared chart theming — keeps all Recharts panels visually coherent.
 * Neutral grays for grid/axes, accent colors for data, consistent tooltip. */

export const CHART_GRID_COLOR = '#e9ecef';
export const CHART_AXIS_COLOR = '#868e96';
export const CHART_AXIS_FONT_SIZE = 12;

export const tooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e9ecef',
  borderRadius: 8,
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.04)',
  padding: '8px 12px',
  fontSize: 13,
} as const;

export const tooltipLabelStyle = {
  color: '#495057',
  fontWeight: 600,
  marginBottom: 4,
} as const;

export const tooltipItemStyle = {
  color: '#212529',
  padding: '2px 0',
} as const;

export const axisStyle = {
  fontSize: CHART_AXIS_FONT_SIZE,
  fill: CHART_AXIS_COLOR,
};
