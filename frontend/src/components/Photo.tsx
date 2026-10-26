import { useState, type ReactNode } from "react";

/**
 * Photo — an image that can never render as a broken-image icon. If the file
 * fails to load (or while it loads), a warm architectural panel shows instead,
 * so overlays and composition stay intact. Children render above the image for
 * gradient scrims and captions.
 */
export function Photo({
  src,
  alt = "",
  className = "",
  imgClassName = "",
  gradient = "bg-gradient-to-br from-pine-300 via-canvas-deep to-brass-300/50",
  children,
}: {
  src: string;
  alt?: string;
  className?: string;
  imgClassName?: string;
  /** Tailwind classes for the fallback surface (applied to the container). */
  gradient?: string;
  children?: ReactNode;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return (
    <div className={`relative isolate overflow-hidden ${gradient} ${className}`}>
      <div className="photo-fallback absolute inset-0" aria-hidden="true">
        <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice" className="h-full w-full" fill="none">
          <path d="M140 260V120a80 80 0 01160 0v140M165 260V120a55 55 0 01110 0v140M190 260V120a30 30 0 0160 0v140M0 210h400" stroke="currentColor" strokeWidth="1" />
        </svg>
      </div>
      {failedSrc !== src && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(src)}
          className={`absolute inset-0 h-full w-full object-cover ${imgClassName}`}
        />
      )}
      {children}
    </div>
  );
}
