/**
 * ProgressChart Component
 *
 * SVG-based circular progress chart for displaying completion percentages.
 */

import React from 'react';

interface ProgressChartProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
  primaryColor?: string;
  secondaryColor?: string;
  label?: string;
  sublabel?: string;
}

export function ProgressChart({
  percentage,
  size = 120,
  strokeWidth = 10,
  primaryColor = '#4ade80',
  secondaryColor = '#1e293b',
  label,
  sublabel,
}: ProgressChartProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(100, Math.max(0, percentage)) / 100) * circumference;

  return (
    <div className="progress-chart" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={secondaryColor}
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={primaryColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
        />
        {/* Center text */}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dy={sublabel ? '-0.2em' : '0.3em'}
          className="progress-chart-value"
          style={{ fill: 'var(--text-primary)', fontSize: size / 4, fontWeight: 600 }}
        >
          {Math.round(percentage)}%
        </text>
        {sublabel && (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dy="1.3em"
            className="progress-chart-sublabel"
            style={{ fill: 'var(--text-muted)', fontSize: size / 10 }}
          >
            {sublabel}
          </text>
        )}
      </svg>
      {label && <div className="progress-chart-label">{label}</div>}
    </div>
  );
}

export default ProgressChart;
