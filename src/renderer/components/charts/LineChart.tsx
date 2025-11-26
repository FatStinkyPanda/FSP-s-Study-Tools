/**
 * LineChart Component
 *
 * SVG-based line chart for displaying trends over time.
 */

import React from 'react';

interface LineChartPoint {
  x: string | number;
  y: number;
}

interface LineChartSeries {
  name: string;
  data: LineChartPoint[];
  color?: string;
}

interface LineChartProps {
  series: LineChartSeries[];
  width?: number;
  height?: number;
  showPoints?: boolean;
  showGrid?: boolean;
  showLegend?: boolean;
  showLabels?: boolean;
  showArea?: boolean;
  yAxisMin?: number;
  yAxisMax?: number;
  animate?: boolean;
}

export function LineChart({
  series,
  width = 400,
  height = 250,
  showPoints = true,
  showGrid = true,
  showLegend = true,
  showLabels = true,
  showArea = false,
  yAxisMin,
  yAxisMax,
  animate = true,
}: LineChartProps) {
  if (series.length === 0 || series.every((s) => s.data.length === 0)) {
    return (
      <div className="line-chart-empty" style={{ width, height }}>
        <span>No data available</span>
      </div>
    );
  }

  const padding = {
    top: showLegend ? 40 : 20,
    right: 20,
    bottom: showLabels ? 40 : 20,
    left: 50,
  };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate Y-axis bounds
  const allValues = series.flatMap((s) => s.data.map((d) => d.y));
  const minY = yAxisMin ?? Math.min(0, Math.min(...allValues));
  const maxY = yAxisMax ?? Math.max(...allValues) * 1.1;
  const yRange = maxY - minY || 1;

  // Get unique X labels
  const xLabels = Array.from(new Set(series.flatMap((s) => s.data.map((d) => String(d.x)))));
  const xStep = chartWidth / (xLabels.length - 1 || 1);

  const defaultColors = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa'];

  // Convert data to SVG path
  const createPath = (data: LineChartPoint[]): string => {
    if (data.length === 0) return '';

    return data
      .map((point, i) => {
        const xIndex = xLabels.indexOf(String(point.x));
        const x = padding.left + xIndex * xStep;
        const y = padding.top + chartHeight - ((point.y - minY) / yRange) * chartHeight;
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  };

  const createAreaPath = (data: LineChartPoint[]): string => {
    if (data.length === 0) return '';

    const linePath = createPath(data);
    const lastX = padding.left + (xLabels.length - 1) * xStep;
    const firstX = padding.left;
    const baseY = padding.top + chartHeight;

    return `${linePath} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  };

  // Grid lines
  const gridLines = [];
  const yTickCount = 5;
  for (let i = 0; i <= yTickCount; i++) {
    const y = padding.top + (chartHeight / yTickCount) * i;
    const value = maxY - (i / yTickCount) * yRange;
    gridLines.push({ y, value });
  }

  return (
    <div className="line-chart">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Grid */}
        {showGrid && (
          <g className="chart-grid">
            {gridLines.map((line, i) => (
              <g key={i}>
                <line
                  x1={padding.left}
                  y1={line.y}
                  x2={width - padding.right}
                  y2={line.y}
                  stroke="var(--border-color)"
                  strokeDasharray="4,4"
                />
                <text
                  x={padding.left - 10}
                  y={line.y}
                  textAnchor="end"
                  dy="0.35em"
                  fill="var(--text-muted)"
                  fontSize="10"
                >
                  {Math.round(line.value)}
                </text>
              </g>
            ))}
          </g>
        )}

        {/* X-axis labels */}
        {showLabels && (
          <g className="chart-x-labels">
            {xLabels.map((label, i) => {
              // Show every other label if too many
              if (xLabels.length > 10 && i % 2 !== 0) return null;
              return (
                <text
                  key={i}
                  x={padding.left + i * xStep}
                  y={height - 10}
                  textAnchor="middle"
                  fill="var(--text-muted)"
                  fontSize="10"
                >
                  {String(label).length > 8 ? String(label).slice(0, 8) : label}
                </text>
              );
            })}
          </g>
        )}

        {/* Lines and areas */}
        {series.map((s, seriesIndex) => {
          const color = s.color || defaultColors[seriesIndex % defaultColors.length];
          const path = createPath(s.data);

          return (
            <g key={seriesIndex}>
              {/* Area fill */}
              {showArea && (
                <path
                  d={createAreaPath(s.data)}
                  fill={color}
                  fillOpacity={0.15}
                  style={{
                    transition: animate ? 'opacity 0.5s ease-in' : 'none',
                  }}
                />
              )}

              {/* Line */}
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transition: animate ? 'stroke-dashoffset 1s ease-out' : 'none',
                }}
              />

              {/* Points */}
              {showPoints &&
                s.data.map((point, pointIndex) => {
                  const xIndex = xLabels.indexOf(String(point.x));
                  const x = padding.left + xIndex * xStep;
                  const y = padding.top + chartHeight - ((point.y - minY) / yRange) * chartHeight;

                  return (
                    <g key={pointIndex}>
                      <circle
                        cx={x}
                        cy={y}
                        r={4}
                        fill={color}
                        stroke="var(--card-bg)"
                        strokeWidth={2}
                      />
                      <title>
                        {s.name}: {point.y}
                      </title>
                    </g>
                  );
                })}
            </g>
          );
        })}

        {/* Legend */}
        {showLegend && series.length > 1 && (
          <g className="chart-legend">
            {series.map((s, i) => {
              const color = s.color || defaultColors[i % defaultColors.length];
              const legendX = padding.left + i * 100;

              return (
                <g key={i}>
                  <rect x={legendX} y={8} width={12} height={12} fill={color} rx={2} />
                  <text x={legendX + 16} y={14} dy="0.35em" fill="var(--text-muted)" fontSize="11">
                    {s.name}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}

export default LineChart;
