export type Category = { id: string; label: string; emoji: string };

export type SiteSettings = {
  siteName: string;
  logoEmoji: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  bgColor: string;
  heroTitle: string;
  footerText: string;
  aboutName: string;
  aboutIntro: string;
  aboutExtra: string;
  aboutEmail: string;
  deliveryText: string;
  categories: Category[];
};

export const DEFAULT_SETTINGS: SiteSettings = {
  siteName: "Print Okay",
  logoEmoji: "🖨️",
  tagline: "Håndlavede 3D printede figurer, fidgets og gadgets — lavet med kærlighed og en masse filament!",
  primaryColor: "#7c3aed",
  accentColor: "#ec4899",
  bgColor: "#faf5ff",
  heroTitle: "🖨️ Print Okay",
  footerText: "Lavet med 💜 og en 3D printer",
  aboutName: "Hej! Jeg hedder [Dit navn]",
  aboutIntro: "Jeg har min egen 3D printer og laver alle mine produkter selv derhjemme.",
  aboutExtra: "Jeg er altid åben for specialbestillinger!",
  aboutEmail: "din@email.dk",
  deliveryText: "Levering med PostNord — 3-7 hverdage\nGratis afhentning kan aftales",
  categories: [
    { id: "figur", label: "Figurer", emoji: "🦕" },
    { id: "fidget", label: "Fidgets", emoji: "🎲" },
    { id: "gadget", label: "Gadgets", emoji: "🔧" },
  ],
};

// Predefined color themes
export const COLOR_THEMES = [
  { name: "Lilla", primary: "#7c3aed", accent: "#ec4899", bg: "#faf5ff" },
  { name: "Blå", primary: "#2563eb", accent: "#06b6d4", bg: "#eff6ff" },
  { name: "Pink", primary: "#db2777", accent: "#f97316", bg: "#fdf2f8" },
  { name: "Grøn", primary: "#16a34a", accent: "#0891b2", bg: "#f0fdf4" },
  { name: "Orange", primary: "#ea580c", accent: "#d97706", bg: "#fff7ed" },
  { name: "Sort", primary: "#18181b", accent: "#71717a", bg: "#fafafa" },
];
