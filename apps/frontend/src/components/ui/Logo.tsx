"use client";

import { useId } from "react";

/**
 * Lumio-Marke. Die Tinte laeuft auf currentColor, der Akzent bleibt fest.
 * variant="mark" = nur die Bildmarke (quadratisch), "full" = Marke + Wortmarke.
 */
export function Logo({
  variant = "full",
  className,
  title = "Lumio",
}: {
  variant?: "mark" | "full";
  className?: string;
  title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const clip = `lumio-cut-${uid}`;
  const accent = "var(--logo-accent, #FF4D2E)";

  const tiles = (
    <g clipPath={`url(#${clip})`}>
      <rect x="0" y="0" width="46" height="46" rx="9" fill={accent} />
      <rect x="54" y="0" width="46" height="46" rx="9" fill="currentColor" />
      <rect x="0" y="54" width="46" height="46" rx="9" fill="currentColor" />
      <rect x="54" y="54" width="46" height="46" rx="9" fill="currentColor" />
    </g>
  );

  const defs = (
    <defs>
      <clipPath id={clip} clipRule="evenodd">
        <path d="M-40,-40 H150 V150 H-40 Z M-40,145.73 L150,-44.27 L150,-57 L-40,133 Z" />
      </clipPath>
    </defs>
  );

  if (variant === "mark") {
    return (
      <svg viewBox="0 0 100 100" className={className} role="img" aria-label={title}>
        {defs}
        {tiles}
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 4066 880" className={className} role="img" aria-label={title}>
      {defs}
      <g transform="translate(0 0.00) scale(8.80000)">
        <g clipPath={`url(#${clip})`}>
          <rect x="0" y="0" width="46" height="46" rx="9" fill={accent} />
          <rect x="54" y="0" width="46" height="46" rx="9" fill="currentColor" />
          <rect x="0" y="54" width="46" height="46" rx="9" fill="currentColor" />
          <rect x="54" y="54" width="46" height="46" rx="9" fill="currentColor" />
        </g>
      </g>
      <g transform="translate(1048.75 786.50) scale(1 -1)">
        <path d="M468 98Q489 98 504 84Q518 70 518 48Q518 28 504 14Q489 0 468 0H132Q110 0 96 15Q81 29 81 51V649Q81 671 96 685Q111 700 134 700Q155 700 170 685Q186 671 186 649V80L164 98ZM1040 526Q1062 526 1076 511Q1090 497 1090 475V212Q1090 108 1033 50Q975 -9 869 -9Q764 -9 706 50Q648 108 648 212V475Q648 497 663 511Q677 526 698 526Q720 526 734 511Q748 497 748 475V212Q748 147 779 115Q810 83 869 83Q929 83 960 115Q990 147 990 212V475Q990 497 1005 511Q1019 526 1040 526ZM1538 535Q1612 535 1653 498Q1693 462 1706 400L1690 404L1697 421Q1710 447 1736 473Q1763 500 1800 517Q1837 535 1879 535Q1948 535 1986 505Q2024 476 2039 426Q2054 376 2054 316V51Q2054 29 2040 15Q2026 0 2004 0Q1982 0 1968 15Q1954 29 1954 51V314Q1954 350 1945 379Q1935 408 1912 426Q1888 443 1847 443Q1808 443 1777 426Q1746 408 1730 379Q1713 350 1713 314V51Q1713 29 1699 15Q1685 0 1663 0Q1641 0 1627 15Q1613 29 1613 51V316Q1613 351 1604 380Q1594 408 1571 426Q1548 443 1507 443Q1468 443 1438 426Q1408 408 1391 380Q1374 351 1374 316V51Q1374 29 1360 15Q1346 0 1324 0Q1303 0 1289 15Q1274 29 1274 51V475Q1274 497 1289 511Q1303 526 1324 526Q1346 526 1360 511Q1374 497 1374 475V416L1356 405Q1362 427 1379 450Q1395 472 1419 492Q1444 511 1474 523Q1504 535 1538 535ZM2333 51Q2333 29 2319 15Q2305 0 2283 0Q2262 0 2247 15Q2233 29 2233 51V479Q2233 501 2248 515Q2262 530 2283 530Q2305 530 2319 515Q2333 501 2333 479ZM3017 263Q3017 183 2982 122Q2946 60 2886 25Q2826 -10 2752 -10Q2677 -10 2617 25Q2557 60 2522 122Q2486 183 2486 263Q2486 344 2522 405Q2557 467 2617 502Q2677 538 2752 538Q2826 538 2886 502Q2946 467 2982 405Q3017 344 3017 263ZM2917 263Q2917 318 2895 358Q2873 399 2836 422Q2798 446 2752 446Q2706 446 2668 422Q2630 399 2608 358Q2586 318 2586 263Q2586 210 2608 169Q2630 128 2668 105Q2706 82 2752 82Q2798 82 2836 105Q2873 128 2895 169Q2917 210 2917 263Z" fill="currentColor" />
        <path d="M2282 596Q2253 596 2240 606Q2227 617 2227 641V658Q2227 683 2241 693Q2256 703 2284 703Q2313 703 2326 692Q2339 682 2339 658V641Q2339 616 2325 606Q2312 596 2282 596Z" fill={accent} />
      </g>
    </svg>
  );
}

export default Logo;
