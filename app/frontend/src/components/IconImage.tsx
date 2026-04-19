export function IconImage({
  src,
  alt,
  size = "md",
  rounded = true
}: {
  src: string | null | undefined;
  alt: string;
  size?: "sm" | "md" | "lg";
  rounded?: boolean;
}) {
  const className = `icon-image ${size} ${rounded ? "rounded" : ""}`;

  if (!src) {
    return <span className={`${className} fallback`} aria-hidden="true" />;
  }

  return <img className={className} src={src} alt={alt} loading="lazy" />;
}
