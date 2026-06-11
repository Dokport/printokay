# printokay sync-agent

Lille sidecar der kører på hjemmeserveren ved siden af Bambuddy og synkroniserer:

1. **Filament: Bambuddy → shop.** Spoler (materiale, farve, restvægt, kr/kg) pushes til
   shoppen, og på-lager/udsolgt sættes automatisk ud fra restvægt.
2. **Modeller: shop → Bambuddy (rundtur).** Modelfiler uploadet i shoppen sendes til Bambuddys
   library; bagefter hentes Bambuddys beregnede printtid/forbrug/pris tilbage på produktet.

Al trafik er **udgående** fra hjemmet — ingen porte åbnes. Loopet kører hvert `SYNC_INTERVAL`
sekund og er idempotent.

## Deploy i Portainer (git-stack)

1. Portainer → **Stacks → Add stack → Git repository**.
2. Repository URL: dette repo. Reference: `refs/heads/bambuddy-sync` (eller `main` efter merge).
   Compose path: `sync-agent/docker-compose.yml`.
3. Udfyld **Environment variables** (se nedenfor).
4. Deploy. Portainer bygger imaget på hosten og starter containeren.

> Enkleste netværksopsætning: sæt `BAMBUDDY_URL=http://192.168.1.155:8109` (host-IP). Så
> behøver containeren ikke dele Docker-netværk med Bambuddy.

## Miljøvariabler

| Variabel | Påkrævet | Beskrivelse |
|---|---|---|
| `BAMBUDDY_URL` | nej | default `http://127.0.0.1:8109` (sidecar + Bambuddy i host-mode) |
| `BAMBUDDY_API_KEY` | ja | Bambuddy API-nøgle (Bearer) |
| `SHOP_URL` | ja | `https://www.printokay.dk` (eller preview-URL ved test) |
| `SHOP_SYNC_TOKEN` | ja | samme værdi som `SYNC_TOKEN` i Vercel |
| `SYNC_INTERVAL` | nej | sekunder mellem kørsler (default 600) |

> Bambuddy kører i `network_mode: host`, så sidecaren gør det samme og når Bambuddy på
> `127.0.0.1:8109`. Containeren laver kun udgående forbindelser — host-mode er sikkert.
| `BAMBUDDY_SPOOLS_PATH` | nej | default `/api/v1/inventory/spools` |
| `BAMBUDDY_UPLOAD_PATH` | nej | default `/api/v1/library/files` (POST, multipart) |
| `BAMBUDDY_FILES_PATH` | nej | default `/api/v1/library/files` (detalje: `/{id}`) |
| `BAMBUDDY_UPLOAD_FIELD` | nej | multipart-feltnavn (default `file`) |
| `BAMBUDDY_FOLDERS_PATH` | nej | default `/api/v1/library/folders/` |
| `BAMBUDDY_PROJECTS_PATH` | nej | default `/api/v1/projects/` |
| `BAMBUDDY_PRINTERS_PATH` | nej | default `/api/v1/printers/` |
| `BAMBUDDY_ROOT_FOLDER` | nej | top-mappe alle produkter lægges under (default `printOKAY`) |
| `BAMBUDDY_COST_TO_OERE` | nej | faktor fra archive-`cost` (kr) til øre (default 100) |
| `DEFAULT_PRINTER_ID` | nej | printer brugt til "send til print" når en request ikke vælger én |
| `FALLBACK_COST_PER_KG_ORE` | nej | kr/kg i øre brugt hvis ingen spole har en pris |

## Bekræftede Bambuddy-endpoints (fra instansens openapi.json)

- **Spoler:** `GET /api/v1/inventory/spools` → felter `id`, `material`, `brand`, `subtype`,
  `color_name`, `rgba`, `label_weight`, `weight_used`, `cost_per_kg`, `archived_at`.
  Restvægt = `label_weight − weight_used`; på lager = ikke arkiveret og restvægt > 0.
- **Model-upload:** `POST /api/v1/library/files` (multipart, felt `file`) → returnerer `id`
  (gemmes som `bambuddyId`).
- **Fil-stats:** `GET /api/v1/library/files/{id}` → `print_time_seconds`, `filament_used_grams`
  (begge `null` indtil filen er sliced — kun sliced `.3mf` har slice-info).
- **Pris (per-materiale):** `GET /api/v1/library/files/{id}/filament-requirements` →
  per-slot `{type, color, used_grams}`. Hver matches mod en synket spole (materiale + farve)
  og ganges med dens `cost_per_kg`. Fallback: materiale-rate → gennemsnit → `FALLBACK_COST_PER_KG_ORE`.

- **Project pr. produkt:** `POST /api/v1/projects/` (`name`, `notes`) → container for produktets
  prints. En linket mappe oprettes med `POST /api/v1/library/folders/` (`name`, `parent_id`,
  `project_id`); begge filer uploades med `?folder_id=<id>`. Hierarki: `printOKAY/<Kategori>/<Produkt>`.
- **Faktiske stats + historik (uden projects):** Bambuddy-Projects kan ikke oprettes via API-nøgle
  (403 — kræver bruger/gruppe-rettighed der ikke kan tildeles nøgler). Vi bruger i stedet selve
  library-filen: `GET /library/files/{id}` giver `print_count` + `last_printed_at`, og `GET /archives/`
  matches til filen via `content_hash` == filens `file_hash` (fallback: filnavn). Aggregeres til
  historik; seneste vellykkede print → autoritative stats (`source="actual"`).
- **Send til print:** `GET /api/v1/printers/` synkes til shoppen; admin vælger printer og opretter
  en request, som sidecaren udfører med `POST /api/v1/library/files/{printFileId}/print?printer_id=<id>`.

> Auth: Bambuddy bruger **`Authorization: Bearer <api-key>`** (HTTPBearer). Endpoints kræver
> blot en gyldig API-nøgle — inventory/library er ikke gated bag de tre printer-tilladelser.

## Lokal test

```bash
cd sync-agent
BAMBUDDY_URL=http://localhost:8000 \
BAMBUDDY_API_KEY=... \
SHOP_URL=http://localhost:3000 \
SHOP_SYNC_TOKEN=dev-sync-token \
SYNC_INTERVAL=30 \
node index.js
```
