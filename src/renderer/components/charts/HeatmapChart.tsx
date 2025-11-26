/**
 * HeatmapChart Component
 *
 * SVG-based heatmap for displaying study activity patterns.
 * Similar to GitHub's contribution graph.
 */

import React from 'react';

interface HeatmapData {
  date: string; // ISO date string
  value: number;
}

interface HeatmapChartProps {
  data: HeatmapData[];
  width?: number;
  height?: number;
  cellSize?: number;
  cellSpacing?: number;
  weeks?: number;
  showLabels?: boolean;
  colorScale?: string[];
  emptyColor?: string;
}

export function HeatmapChart({
  data,
  width = 700,
  height = 120,
  cellSize = 12,
  cellSpacing = 3,
  weeks = 20,
  showLabels = true,
  colorScale = ['#1e293b', '#166534', '#22c55e', '#4ade80', '#86efac'],
  emptyColor = '#0f172a',
}: HeatmapChartProps) {
  // Create a map of date -> value for quick lookup
  const dataMap = new Map(
    data.map((d) => {
      const dateKey = new Date(d.date).toISOString().split('T')[0];
      return [dateKey, d.value];
    })
  );

  // Generate grid of days
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysToShow = weeks * 7;

  // Start from the most recent Sunday
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - today.getDay() - (weeks - 1) * 7);

  const cells: Array<{
    date: Date;
    value: number;
    week: number;
    day: number;
  }> = [];

  for (let i = 0; i < daysToShow; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    if (date > today) break;

    const dateKey = date.toISOString().split('T')[0];
    const value = dataMap.get(dateKey) || 0;
    const week = Math.floor(i / 7);
    const day = date.getDay();

    cells.push({ date, value, week, day });
  }

  // Find max value for color scaling
  const maxValue = Math.max(...cells.map((c) => c.value), 1);

  // Get color for a value
  const getColor = (value: number): string => {
    if (value === 0) return emptyColor;
    const ratio = value / maxValue;
    const index = Math.min(Math.floor(ratio * (colorScale.length - 1)) + 1, colorScale.length - 1);
    return colorScale[index];
  };

  // Day labels
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Month labels
  const monthLabels: Array<{ month: string; week: number }> = [];
  let lastMonth = -1;
  cells.forEach((cell) => {
    const month = cell.date.getMonth();
    if (month !== lastMonth) {
      monthLabels.push({
        month: cell.date.toLocaleDateString('en-US', { month: 'short' }),
        week: cell.week,
      });
      lastMonth = month;
    }
  });

  const labelOffset = showLabels ? 30 : 0;
  const monthLabelHeight = showLabels ? 16 : 0;
  const totalWidth = labelOffset + weeks * (cellSize + cellSpacing);
  const totalHeight = monthLabelHeight + 7 * (cellSize + cellSpacing);

  return (
    <div className="heatmap-chart">
      <svg
        width={Math.min(width, totalWidth)}
        height={Math.min(height, totalHeight)}
        viewBox={`0 0 ${totalWidth} ${totalHeight}`}
      >
        {/* Month labels */}
        {showLabels &&
          monthLabels.map((label, i) => (
            <text
              key={i}
              x={labelOffset + label.week * (cellSize + cellSpacing)}
              y={10}
              fill="var(--text-muted)"
              fontSize="10"
            >
              {label.month}
            </text>
          ))}

        {/* Day labels */}
        {showLabels &&
          [1, 3, 5].map((day) => (
            <text
              key={day}
              x={0}
              y={monthLabelHeight + day * (cellSize + cellSpacing) + cellSize / 2}
              dy="0.35em"
              fill="var(--text-muted)"
              fontSize="9"
            >
              {dayLabels[day]}
            </text>
          ))}

        {/* Cells */}
        {cells.map((cell, i) => (
          <rect
            key={i}
            x={labelOffset + cell.week * (cellSize + cellSpacing)}
            y={monthLabelHeight + cell.day * (cellSize + cellSpacing)}
            width={cellSize}
            height={cellSize}
            fill={getColor(cell.value)}
            rx={2}
            style={{ transition: 'fill 0.2s ease' }}
          >
            <title>
              {cell.date.toLocaleDateString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
              })}
              : {cell.value} {cell.value === 1 ? 'session' : 'sessions'}
            </title>
          </rect>
        ))}
      </svg>

      {/* Legend */}
      <div className="heatmap-legend">
        <span>Less</span>
        {colorScale.map((color, i) => (
          <div
            key={i}
            className="heatmap-legend-cell"
            style={{
              width: cellSize,
              height: cellSize,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

export default HeatmapChart;
