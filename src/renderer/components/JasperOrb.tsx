import React, { useEffect, useRef, useState } from 'react';
import './JasperOrb.css';

export type JasperState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'processing'
  | 'success'
  | 'error'
  | 'attention';

interface JasperOrbProps {
  state?: JasperState;
  size?: 'small' | 'medium' | 'large';
  audioLevel?: number; // 0-1, for reactive listening animation
  onClick?: () => void;
  className?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  hue: number;
}

const STATE_COLORS: Record<JasperState, { primary: string; secondary: string; glow: string }> = {
  idle: { primary: '#4A90D9', secondary: '#2563eb', glow: '#3b82f6' },
  listening: { primary: '#64B5F6', secondary: '#3b82f6', glow: '#60a5fa' },
  thinking: { primary: '#7C4DFF', secondary: '#8b5cf6', glow: '#a78bfa' },
  speaking: { primary: '#00BCD4', secondary: '#06b6d4', glow: '#22d3ee' },
  processing: { primary: '#FF9800', secondary: '#f59e0b', glow: '#fbbf24' },
  success: { primary: '#4CAF50', secondary: '#22c55e', glow: '#4ade80' },
  error: { primary: '#F44336', secondary: '#ef4444', glow: '#f87171' },
  attention: { primary: '#FFEB3B', secondary: '#eab308', glow: '#facc15' },
};

const SIZE_MAP = {
  small: 80,
  medium: 120,
  large: 180,
};

export function JasperOrb({
  state = 'idle',
  size = 'medium',
  audioLevel = 0,
  onClick,
  className = '',
}: JasperOrbProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const [isHovered, setIsHovered] = useState(false);

  const orbSize = SIZE_MAP[size];
  const colors = STATE_COLORS[state];

  // Initialize particles
  useEffect(() => {
    const particleCount = state === 'thinking' ? 30 : state === 'processing' ? 20 : 15;
    particlesRef.current = Array.from({ length: particleCount }, () => ({
      x: Math.random() * orbSize,
      y: Math.random() * orbSize,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      radius: Math.random() * 3 + 1,
      opacity: Math.random() * 0.5 + 0.3,
      hue: Math.random() * 60,
    }));
  }, [state, orbSize]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const centerX = orbSize / 2;
    const centerY = orbSize / 2;
    const baseRadius = orbSize * 0.35;
    let phase = 0;
    let rotationAngle = 0;

    const animate = () => {
      ctx.clearRect(0, 0, orbSize, orbSize);
      phase += 0.02;
      rotationAngle += state === 'processing' ? 0.03 : 0.005;

      // Calculate dynamic radius based on state
      let dynamicRadius = baseRadius;
      if (state === 'listening') {
        dynamicRadius = baseRadius + audioLevel * 15 + Math.sin(phase * 3) * 5;
      } else if (state === 'speaking') {
        dynamicRadius = baseRadius + Math.sin(phase * 4) * 8;
      } else if (state === 'idle') {
        dynamicRadius = baseRadius + Math.sin(phase) * 3;
      } else if (state === 'success' || state === 'error') {
        dynamicRadius = baseRadius + Math.sin(phase * 6) * 5;
      }

      // Draw glow
      const gradient = ctx.createRadialGradient(
        centerX,
        centerY,
        dynamicRadius * 0.5,
        centerX,
        centerY,
        dynamicRadius * 1.5
      );
      gradient.addColorStop(0, colors.glow + '80');
      gradient.addColorStop(0.5, colors.glow + '40');
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, dynamicRadius * 1.5, 0, Math.PI * 2);
      ctx.fill();

      // Draw outer ring for speaking state (radiating waves)
      if (state === 'speaking') {
        for (let i = 0; i < 3; i++) {
          const wavePhase = (phase * 2 + i * 0.5) % 2;
          const waveRadius = dynamicRadius + wavePhase * 20;
          const waveOpacity = Math.max(0, 1 - wavePhase / 2);

          ctx.strokeStyle = colors.glow + Math.round(waveOpacity * 128).toString(16).padStart(2, '0');
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(centerX, centerY, waveRadius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Draw particles for thinking/processing states
      if (state === 'thinking' || state === 'processing') {
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.rotate(rotationAngle);
        ctx.translate(-centerX, -centerY);

        particlesRef.current.forEach((particle) => {
          // Update particle position
          particle.x += particle.vx;
          particle.y += particle.vy;

          // Contain within orb
          const dx = particle.x - centerX;
          const dy = particle.y - centerY;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > dynamicRadius * 0.8) {
            particle.vx *= -0.8;
            particle.vy *= -0.8;
            particle.x = centerX + (dx / dist) * dynamicRadius * 0.8;
            particle.y = centerY + (dy / dist) * dynamicRadius * 0.8;
          }

          // Draw particle
          ctx.fillStyle = colors.secondary + Math.round(particle.opacity * 255).toString(16).padStart(2, '0');
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          ctx.fill();
        });

        ctx.restore();
      }

      // Draw main orb
      const orbGradient = ctx.createRadialGradient(
        centerX - dynamicRadius * 0.3,
        centerY - dynamicRadius * 0.3,
        0,
        centerX,
        centerY,
        dynamicRadius
      );
      orbGradient.addColorStop(0, colors.primary);
      orbGradient.addColorStop(0.7, colors.secondary);
      orbGradient.addColorStop(1, colors.secondary + '80');

      ctx.fillStyle = orbGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, dynamicRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw highlight
      const highlightGradient = ctx.createRadialGradient(
        centerX - dynamicRadius * 0.4,
        centerY - dynamicRadius * 0.4,
        0,
        centerX - dynamicRadius * 0.2,
        centerY - dynamicRadius * 0.2,
        dynamicRadius * 0.5
      );
      highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
      highlightGradient.addColorStop(1, 'transparent');

      ctx.fillStyle = highlightGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, dynamicRadius, 0, Math.PI * 2);
      ctx.fill();

      // Draw attention ring
      if (state === 'attention' || isHovered) {
        const ringPhase = Math.sin(phase * 3) * 0.5 + 0.5;
        ctx.strokeStyle = colors.glow + Math.round(ringPhase * 200).toString(16).padStart(2, '0');
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(centerX, centerY, dynamicRadius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw error shake effect
      if (state === 'error') {
        const shakeX = Math.sin(phase * 20) * 3;
        ctx.translate(shakeX, 0);
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [state, orbSize, colors, audioLevel, isHovered]);

  return (
    <div
      className={`jasper-orb jasper-orb-${size} jasper-orb-${state} ${className}`}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      role="button"
      tabIndex={0}
      aria-label={`Jasper AI - ${state}`}
    >
      <canvas
        ref={canvasRef}
        width={orbSize}
        height={orbSize}
        className="jasper-orb-canvas"
      />
      <div className="jasper-orb-label">JASPER</div>
    </div>
  );
}

export default JasperOrb;
