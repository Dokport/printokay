import Image from "next/image";
import { SiteSettings } from "@/lib/settings";
import { readJsonFile } from "@/lib/storage";
import { mergeSettings } from "@/lib/settingsMerge";

export const dynamic = "force-dynamic";

export default async function OmPage() {
  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  const s: SiteSettings = mergeSettings(stored);

  return (
    <div className="max-w-2xl mx-auto py-8">
      <h1 className="text-3xl font-bold mb-6" style={{ color: s.primaryColor }}>Om mig 👋</h1>

      <div className="bg-white rounded-2xl p-8 shadow-sm space-y-4 text-gray-700 leading-relaxed">
        {/* Profile header — image + name side by side if image exists */}
        <div className="flex items-center gap-5">
          {s.aboutImage && (
            <div className="relative w-24 h-24 rounded-2xl overflow-hidden flex-shrink-0 border border-gray-100 shadow-sm">
              <Image src={s.aboutImage} alt={s.aboutName} fill className="object-cover" unoptimized />
            </div>
          )}
          <p className="text-lg">
            <strong style={{ color: s.primaryColor }}>{s.aboutName}</strong>
          </p>
        </div>
        <p>{s.aboutIntro}</p>
        {s.aboutExtra && <p>{s.aboutExtra}</p>}

        <div className="rounded-xl p-4 mt-6" style={{ backgroundColor: `color-mix(in srgb, ${s.bgColor} 80%, white)` }}>
          <h2 className="font-semibold mb-2" style={{ color: s.primaryColor }}>Kontakt</h2>
          <p>
            Email:{" "}
            <a href={`mailto:${s.aboutEmail}`} className="underline" style={{ color: s.primaryColor }}>
              {s.aboutEmail}
            </a>
          </p>
          <p className="mt-1 text-sm text-gray-500">Jeg svarer typisk inden for 1-2 dage</p>
        </div>

        <div className="rounded-xl p-4" style={{ backgroundColor: `color-mix(in srgb, ${s.bgColor} 80%, white)` }}>
          <h2 className="font-semibold mb-2" style={{ color: s.primaryColor }}>Levering & retur</h2>
          <ul className="text-sm space-y-1">
            {s.deliveryText.split("\n").filter(Boolean).map((line, i) => (
              <li key={i}>• {line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
