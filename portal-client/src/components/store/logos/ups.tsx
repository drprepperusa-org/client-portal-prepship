// @ts-nocheck
// UPS shield — flat, ID-FREE rendition (solid fills only; no gradients,
// clipPaths, masks, or internal id="" references).
//
// Why: the previous full-detail logo carried ~90 hardcoded internal IDs
// (id="A".."az") plus 60+ fill="url(#…)" references. When more than one UPS
// badge renders on a page those IDs collide, and on iOS Safari the duplicate
// id + url(#…) paint references fail to resolve and the shield renders SOLID
// BLACK. Flat solid fills sidestep that class of bug entirely and render
// identically on every browser.
//
// Sized by the `height` prop; width preserves the UPS aspect (~0.733) so the
// shield never distorts at any size (CarrierBadge passes H.ups = 34).
export default function UpsLogo({ height = 22, ...props }: { height?: number } & React.SVGProps<SVGSVGElement>) {
  const width = Math.round(height * (96 / 131));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox="0 0 96 131"
      role="img"
      aria-label="UPS"
      {...props}
    >
      {/* Brown shield body */}
      <path
        fill="#351C15"
        d="M48 5C36 7 19 11 9 14c-1 22-1 48 1 66 3 24 22 41 38 47 16-6 35-23 38-47 2-18 2-44 1-66C78 11 60 7 48 5Z"
      />
      {/* Gold heraldic knot/bowtie near the top */}
      <path
        fill="#FFB500"
        d="M48 28c-6 8-14 12-21 14 7 5 15 9 21 17 6-8 14-12 21-17-7-2-15-6-21-14Z"
      />
      {/* Gold "ups" wordmark (lowercase italic serif) */}
      <text
        x="48"
        y="96"
        textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif"
        fontStyle="italic"
        fontWeight="700"
        fontSize="34"
        fill="#FFB500"
      >
        ups
      </text>
    </svg>
  );
}
