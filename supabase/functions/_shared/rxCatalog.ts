// Shared form vocabulary; no patient data or clinical recommendations.
export const RX_CATEGORIES = {
  "Crown - tooth": {
    materials: [
      "Monolithic Zirconia",
      "Layered Zirconia",
      "Lithium Disilicate (E.max)",
      "PFM (Porcelain-Fused-to-Metal)",
      "Full Gold / Precious",
      "Feldspathic Porcelain",
      "PMMA Provisional",
    ],
  },
  "Crown - implant": {
    materials: ["Zirconia", "E.max", "PFM", "PMMA"],
  },
  "Bridge - tooth (conventional)": {
    materials: [
      "Monolithic Zirconia",
      "Layered Zirconia",
      "Lithium Disilicate (E.max)",
      "PFM (Porcelain-Fused-to-Metal)",
      "Full Gold / Precious",
      "PMMA Provisional",
    ],
  },
  "Bridge - tooth (Resin Bonded)": {
    materials: [
      "Monolithic Zirconia",
      "Lithium Disilicate (E.max)",
      "PFM (metal wing)",
      "Cast Metal Wing",
    ],
  },
  "Bridge - implant": {
    materials: ["Zirconia", "E.max", "PFM", "PMMA", "Zirconia with metal bar"],
  },
  Veneer: {
    materials: [
      "Lithium Disilicate (E.max)",
      "Feldspathic Porcelain",
      "Layered Zirconia",
      "Composite",
      "PMMA Provisional",
    ],
  },
  "Removable partial denture": {
    materials: [
      "Cobalt-Chrome RPD Framework",
      "Removable Partial Denture - Acrylic (with clasps)",
      "Removable Partial Denture - Acrylic (no clasps)",
      "Flexible Partial (Nylon / Valplast)",
      "Cast Metal Partial",
      "Immediate Denture",
    ],
  },
  // Split from Removable denture (2026-08-22): partials are priced per tooth
  // (first tooth in the base, + fee per additional), complete dentures per
  // ARCH (single vs both) — two different price models need two categories.
  "Complete denture": {
    materials: ["Acrylic Complete Denture", "Acrylic Overdenture", "Immediate Denture", "Flexible (Nylon / Valplast)"],
  },
  "Orthodontics splint": { materials: [] },
  "Single layer splint - soft": { materials: [] },
  "Double layer splint - soft": { materials: [] },
  "Double layer splint - outer hard, inner soft": { materials: [] },
  "Michigan splint": { materials: [] },
  // Arch-based appliances (2026-08-21): ordered per arch — upper, lower, or
  // both — with per-arch pricing on the lab side. No material/shade fields.
  "Clear retainer": { materials: [] },
  "Night guard": { materials: [] },
  "Fixed retainer": { materials: [] },
  "Space maintainer": { materials: [] },
  "Study model": { materials: [] },
  "Special tray": { materials: [] },
  "Others - refer to notes": { materials: ["Refer to notes"] },
};
export const RX_SHADE_GUIDES = {
  "Vita Classical": ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4"],
  "Vita 3D-Master": [
    "0M1", "0M2", "0M3", "1M1", "1M2", "2L1.5", "2L2.5", "2M1", "2M2", "2M3", "2R1.5", "2R2.5",
    "3L1.5", "3L2.5", "3M1", "3M2", "3M3", "3R1.5", "3R2.5", "4L1.5", "4L2.5", "4M1", "4M2", "4M3",
    "4R1.5", "4R2.5", "5M1", "5M2", "5M3",
  ],
  "Ivoclar Chromascop": [
    "110", "120", "130", "140", "210", "220", "230", "240", "310", "320", "330", "340",
    "410", "420", "430", "440", "510", "520", "530", "540",
  ],
  "Bleach / Whitening": ["BL1", "BL2", "BL3", "BL4"],
  "Custom / Photo": ["Custom (see photo)"],
};
export const UNIVERSAL_TO_FDI = {
  1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
  9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
  17: 38, 18: 37, 19: 36, 20: 35, 21: 34, 22: 33, 23: 32, 24: 31,
  25: 41, 26: 42, 27: 43, 28: 44, 29: 45, 30: 46, 31: 47, 32: 48,
};
