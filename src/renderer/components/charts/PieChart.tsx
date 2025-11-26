/**
 * PieChart Component
 *
 * SVG-based pie/donut chart for displaying distribution data.
 */

import React from 'react';

interface PieChartData {
  label: string;
  value: number;
  color?: string;
}

interface PieChartProps {
  data: PieChartData[];
  size?: number;
  innerRadius?: number; // 0 for pie, > 0 for donut
  showLabels?: boolean;
  showLegend?: boolean;
  showValues?: boolean;
  animate?: boolean;
}

export function PieChart({
  data,
  size = 200,
  innerRadius = 0,
  showLabels = true,
  showLegend = true,
  showValues = true,
  animate = true,
}: PieChartProps) {
  if (data.length === 0 || data.every((d) => d.value === 0)) {
    return (
      <div className="pie-chart-empty" style={{ width: size, height: size }}>
        <span>No data available</span>
      </div>
    );
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const center = size / 2;
  const outerRadius = size / 2 - 10;
  const labelRadius = outerRadius * 0.7;

  const defaultColors = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#34d399', '#fb923c'];

  // Calculate slices
  let currentAngle = -Math.PI / 2; // Start from top
  const slices = data.map((item, index) => {
    const percentage = item.value / total;
    const angle = percentage * Math.PI * 2;
    const startAngle = currentAngle;
    const endAngle = currentAngle + angle;
    currentAngle = endAngle;

    // Calculate path for slice
    const largeArcFlag = angle > Math.PI ? 1 : 0;
    const startOuter = {
      x: center + Math.cos(startAngle) * outerRadius,
      y: center + Math.sin(startAngle) * outerRadius,
    };
    const endOuter = {
      x: center + Math.cos(endAngle) * outerRadius,
      y: center + Math.sin(endAngle) * outerRadius,
    };

    let path: string;
    if (innerRadius > 0) {
      // Donut
      const startInner = {
        x: center + Math.cos(endAngle) * innerRadius,
        y: center + Math.sin(endAngle) * innerRadius,
      };
      const endInner = {
        x: center + Math.cos(startAngle) * innerRadius,
        y: center + Math.sin(startAngle) * innerRadius,
      };
      path = [
        `M ${startOuter.x} ${startOuter.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}`,
        `L ${startInner.x} ${startInner.y}`,
        `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${endInner.x} ${endInner.y}`,
        'Z',
      ].join(' ');
    } else {
      // Full pie
      path = [
        `M ${center} ${center}`,
        `L ${startOuter.x} ${startOuter.y}`,
        `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}`,
        'Z',
      ].join(' ');
    }

    // Calculate label position
    const labelAngle = startAngle + angle / 2;
    const labelPos = {
      x: center + Math.cos(labelAngle) * labelRadius,
      y: center + Math.sin(labelAngle) * labelRadius,
    };

    return {
      ...item,
      percentage,
      path,
      labelPos,
      color: item.color || defaultColors[index % defaultColors.length],
    };
  });

  return (
    <div className="pie-chart-container">
      <div className="pie-chart">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {slices.map((slice, index) => (
            <g key={index}>
              <path
                d={slice.path}
                fill={slice.color}
                stroke="var(--card-bg)"
                strokeWidth={2}
                style={{
                  transition: animate ? 'opacity 0.3s ease' : 'none',
                }}
                className="pie-slice"
              >
                <title>
                  {slice.label}: {slice.value} ({(slice.percentage * 100).toFixed(1)}%)
                </title>
              </path>
              {showLabels && slice.percentage > 0.05 && (
                <text
                  x={slice.labelPos.x}
                  y={slice.labelPos.y}
                  textAnchor="middle"
                  dy="0.35em"
                  fill="white"
                  fontSize="11"
                  fontWeight="600"
                  style={{ pointerEvents: 'none' }}
                >
                  {showValues
                    ? `${(slice.percentage * 100).toFixed(0)}%`
                    : slice.label.slice(0, 3)}
                </text>
              )}
            </g>
          ))}

          {/* Center text for donut */}
          {innerRadius > 0 && (
            <text
              x={center}
              y={center}
              textAnchor="middle"
              dy="0.35em"
              fill="var(--text-primary)"
              fontSize={size / 8}
              fontWeight="600"
            >
              {total}
            </text>
          )}
        </svg>
      </div>

      {/* Legend */}
      {showLegend && (
        <div className="pie-legend">
          {slices.map((slice, index) => (
            <div key={index} className="pie-legend-item">
              <div
                className="pie-legend-color"
                style={{ backgroundColor: slice.color }}
              />
              <span className="pie-legend-label">{slice.label}</span>
              <span className="pie-legend-value">
                {slice.value} ({(slice.percentage * 100).toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PieChart;
