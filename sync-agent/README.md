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
2. Repository URL: dette repo. Compose path: `sync-agent/docker-compose.yml`.
3. Udfyld **Environment variables** (se nedenfor).
4. Deploy. Portainer bygger imaget på hosten og starter containeren.

## Miljøvariabler

| Variabel | Påkrævet | Beskrivelse |
|---|---|---|
| `BAMBUDDY_URL` | ja | fx `http://bambuddy:8000` (containernavn på det delte netværk) |
| `BAMBUDDY_API_KEY` | ja | API-nøgle fra Bambuddy **med library/file-tilladelse** |
| `SHOP_URL` | ja | `https://www.printokay.dk` (eller preview-URL ved test) |
| `SHOP_SYNC_TOKEN` | ja | samme værdi som `SYNC_TOKEN` i Vercel |
| `SYNC_INTERVAL` | nej | sekunder mellem kørsler (default 600) |
| `BAMBUDDY_NETWORK` | ja | navnet på Bambuddys Docker-netværk (Portainer → Networks) |
| `BAMBUDDY_SPOOLS_PATH` | nej | default `/api/v1/inventory/spools` |
| `BAMBUDDY_UPLOAD_PATH` | nej | default `/api/v1/library/files` (POST, multipart) |
| `BAMBUDDY_FILES_PATH` | nej | default `/api/v1/library/files` (detalje: `/{id}`) |
| `BAMBUDDY_UPLOAD_FIELD` | nej | multipart-feltnavn (default `file`) |
| `FALLBACK_COST_PER_KG_ORE` | nej | kr/kg i øre brugt hvis ingen spole har en pris |

## Bekræftede Bambuddy-endpoints (fra instansens openapi.json)

- **Spoler:** `GET /api/v1/inventory/spools` → felter `id`, `material`, `brand`, `subtype`,
  `color_name`, `rgba`, `label_weight`, `weight_used`, `cost_per_kg`, `archived_at`.
  Restvægt = `label_weight − weight_used`; på lager = ikke arkiveret og restvægt > 0.
- **Model-upload:** `POST /api/v1/library/files` (multipart, felt `file`) → returnerer `id`
  (gemmes som `bambuddyId`).
- **Fil-stats:** `GET /api/v1/library/files/{id}` → `print_time_seconds`, `filament_used_grams`
  (begge `null` indtil Bambuddy har sliced filen). Pris findes ikke på filen og beregnes som
  `gram × cost_per_kg` fra den synkroniserede filament.

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
