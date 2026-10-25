import { useState, type ReactNode } from "react";

/**
 * Photo — an image that can never render as a broken-image icon. If the file
 * fails to load (or while it loads), a warm brand gradient shows instead, so
 * overlays and composition stay intact. Children render above the image for
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
  const [failed, setFailed] = useState(false);
  return (
    <div className={`relative overflow-hidden ${gradient} ${className}`}>
      {!failed && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={`h-full w-full object-cover ${imgClassName}`}
        />
      )}
      {children}
    </div>
  );
}
