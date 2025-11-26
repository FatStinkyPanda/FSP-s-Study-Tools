/**
 * BarChart Component
 *
 * SVG-based bar chart for displaying comparative data.
 */

import React from 'react';

interface BarChartData {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartData[];
  width?: number;
  height?: number;
  barSpacing?: number;
  showValues?: boolean;
  showLabels?: boolean;
  horizontal?: boolean;
  maxValue?: number;
  animate?: boolean;
}

export function BarChart({
  data,
  width = 300,
  height = 200,
  barSpacing = 8,
  showValues = true,
  showLabels = true,
  horizontal = false,
  maxValue,
  animate = true,
}: BarChartProps) {
  if (data.length === 0) {
    return (
      <div className="bar-chart-empty" style={{ width, height }}>
        <span>No data available</span>
      </div>
    );
  }

  const max = maxValue || Math.max(...data.map((d) => d.value), 1);
  const padding = { top: 20, right: 20, bottom: showLabels ? 40 : 20, left: showValues ? 40 : 20 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const defaultColors = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399'];

  if (horizontal) {
    const barHeight = (chartHeight - barSpacing * (data.length - 1)) / data.length;

    return (
      <div className="bar-chart">
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {data.map((item, index) => {
            const barWidth = (item.value / max) * chartWidth;
            const y = padding.top + index * (barHeight + barSpacing);
            const color = item.color || defaultColors[index % defaultColors.length];

            return (
              <g key={index}>
                {/* Bar background */}
                <rect
                  x={padding.left}
                  y={y}
                  width={chartWidth}
                  height={barHeight}
                  fill="var(--border-color)"
                  rx={4}
                />
                {/* Bar */}
                <rect
                  x={padding.left}
                  y={y}
                  width={animate ? barWidth : 0}
                  height={barHeight}
                  fill={color}
                  rx={4}
                  style={{
                    transition: animate ? 'width 0.5s ease-out' : 'none',
                    transitionDelay: `${index * 100}ms`,
                  }}
                >
                  {animate && (
                    <animate
                      attributeName="width"
                      from="0"
                      to={barWidth}
                      dur="0.5s"
                      begin={`${index * 0.1}s`}
                      fill="freeze"
                    />
                  )}
                </rect>
                {/* Value label */}
                {showValues && (
                  <text
                    x={padding.left + barWidth + 5}
                    y={y + barHeight / 2}
                    dy="0.35em"
                    fill="var(--text-primary)"
                    fontSize="12"
                    style={{ opacity: barWidth > 0 ? 1 : 0 }}
                  >
                    {item.value}
                  </text>
                )}
                {/* Bar label */}
                {showLabels && (
                  <text
                    x={padding.left - 5}
                    y={y + barHeight / 2}
                    dy="0.35em"
                    textAnchor="end"
                    fill="var(--text-muted)"
                    fontSize="11"
                  >
                    {item.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    );
  }

  // Vertical bars
  const barWidth = (chartWidth - barSpacing * (data.length - 1)) / data.length;

  return (
    <div className="bar-chart">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {data.map((item, index) => {
          const barHeight = (item.value / max) * chartHeight;
          const x = padding.left + index * (barWidth + barSpacing);
          const y = padding.top + chartHeight - barHeight;
          const color = item.color || defaultColors[index % defaultColors.length];

          return (
            <g key={index}>
              {/* Bar background */}
              <rect
                x={x}
                y={padding.top}
                width={barWidth}
                height={chartHeight}
                fill="var(--border-color)"
                rx={4}
              />
              {/* Bar */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={color}
                rx={4}
                style={{
                  transition: animate ? 'height 0.5s ease-out, y 0.5s ease-out' : 'none',
                  transitionDelay: `${index * 100}ms`,
                }}
              />
              {/* Value label */}
              {showValues && barHeight > 20 && (
                <text
                  x={x + barWidth / 2}
                  y={y + 15}
                  textAnchor="middle"
                  fill="white"
                  fontSize="11"
                  fontWeight="600"
                >
                  {item.value}
                </text>
              )}
              {/* Bar label */}
              {showLabels && (
                <text
                  x={x + barWidth / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10"
                >
                  {item.label.length > 6 ? item.label.slice(0, 6) + '...' : item.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default BarChart;
