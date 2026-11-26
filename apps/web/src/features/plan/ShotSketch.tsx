import { useId } from 'react';
import styles from './ShotSketch.module.css';
import type { SketchScene, SketchSpec } from './sketchSpec';

// 手繪稿：線條、不上色，用 SVG 濾鏡讓線條有一點手抖。畫布 160×120，地平線在 y=95。

function Scene({ scene }: { scene: SketchScene }) {
  switch (scene) {
    case 'facade':
      return (
        <>
          <path d="M8 95H152" />
          <path d="M28 56Q80 30 132 56" />
          <path d="M22 60Q32 62 36 56M138 56Q142 62 150 60" />
          <path d="M34 62H126V95H34Z" />
          <path d="M60 95V74H76V95M84 95V74H100V95" />
          <path d="M52 62V95M108 62V95" />
          <path d="M76 24Q74 16 80 12M84 22Q88 16 82 8" strokeDasharray="2 3" />
        </>
      );
    case 'gate':
      return (
        <>
          <path d="M8 95H152" />
          <path d="M24 44Q80 22 136 44" />
          <path d="M30 44V95M130 44V95" />
          <path d="M56 95V62Q80 46 104 62V95" />
          <path d="M36 95V70H52V95M108 95V70H124V95" />
        </>
      );
    case 'hall':
      return (
        <>
          <path d="M8 95H152" />
          <path d="M20 14V95M140 14V95" />
          <path d="M66 70V38Q80 28 94 38V70" />
          <path d="M52 70H108V95H52" />
          <path d="M34 24V38M126 24V38" />
          <circle cx="34" cy="44" r="6" />
          <circle cx="126" cy="44" r="6" />
        </>
      );
    case 'courtyard':
      return (
        <>
          <path d="M8 80H152" />
          <path d="M50 52Q80 40 110 52M54 52V80M106 52V80M54 80H106" />
          <path d="M8 118L58 80M152 118L102 80M40 118L68 80M120 118L92 80M80 118V80" />
        </>
      );
    case 'roof':
      return (
        <>
          <path d="M4 40Q40 26 80 30Q120 26 156 40" />
          <path d="M4 40Q-2 30 10 24M156 40Q162 30 150 24" />
          <path d="M14 52Q80 38 146 52M24 66Q80 52 136 66M34 80Q80 66 126 80" />
          <path d="M70 30Q80 12 90 30" />
        </>
      );
    default:
      return (
        <>
          <path d="M8 95H152" />
          <path d="M20 95V50H140V95" strokeDasharray="4 4" />
        </>
      );
  }
}

function Figure({ x, size }: { x: number; size: SketchSpec['figureSize'] }) {
  if (size === 'close') {
    return (
      <>
        <circle cx={x} cy="64" r="22" />
        <path d={`M${x - 46} 120Q${x - 40} 92 ${x} 92Q${x + 40} 92 ${x + 46} 120`} />
      </>
    );
  }
  if (size === 'medium') {
    return (
      <>
        <circle cx={x} cy="42" r="9" />
        <path d={`M${x - 18} 95Q${x - 16} 56 ${x} 56Q${x + 16} 56 ${x + 18} 95`} />
      </>
    );
  }
  return (
    <>
      <circle cx={x} cy="75" r="3.5" />
      <path d={`M${x - 5} 95Q${x - 5} 81 ${x} 81Q${x + 5} 81 ${x + 5} 95`} />
    </>
  );
}

function figureXs(count: number, size: SketchSpec['figureSize']): number[] {
  if (count === 0) return [];
  if (count === 1) return [80];
  return size === 'close' ? [52, 108] : [62, 98];
}

function Motion({ motion }: { motion: SketchSpec['motion'] }) {
  if (motion === 'in') return <path className={styles.motion} d="M8 8L24 20M152 8L136 20M8 112L24 100M152 112L136 100" />;
  if (motion === 'out') return <path className={styles.motion} d="M24 20L8 8M136 20L152 8M24 100L8 112M136 100L152 112" />;
  if (motion === 'pan') return <path className={styles.motion} d="M30 108H130M30 108L38 103M30 108L38 113M130 108L122 103M130 108L122 113" />;
  return null;
}

type ShotSketchProps = { spec: SketchSpec; label: string };

/** 一格的手繪稿；label 是給輔助科技的說明（例如「遠景・推，廟前全景」） */
export function ShotSketch({ spec, label }: ShotSketchProps) {
  const filterId = `sketch-${useId().replace(/:/g, '')}`;
  const clipId = `${filterId}-clip`;
  return (
    <svg className={styles.sketch} viewBox="0 0 160 120" role="img" aria-label={`手繪稿：${label}`}>
      <defs>
        <filter id={filterId} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" />
        </filter>
        <clipPath id={clipId}>
          <rect x="0" y="0" width="160" height="120" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`} filter={`url(#${filterId})`} className={styles.lines}>
        <g transform={`translate(80 70) scale(${spec.zoom}) translate(-80 -70)`} strokeWidth={1.6 / spec.zoom}>
          <Scene scene={spec.scene} />
        </g>
        {figureXs(spec.figures, spec.figureSize).map((x) => (
          <g key={x} className={styles.figure}>
            <Figure x={x} size={spec.figureSize} />
          </g>
        ))}
        <Motion motion={spec.motion} />
      </g>
    </svg>
  );
}
