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
| `BAMBUDDY_SPOOLS_PATH` | nej | override hvis `/docs` viser et andet spole-endpoint |
| `BAMBUDDY_UPLOAD_PATH` | nej | default `/api/v1/library/files/upload` |
| `BAMBUDDY_FILES_PATH` | nej | default `/api/v1/library/files` |
| `BAMBUDDY_UPLOAD_FIELD` | nej | multipart-feltnavn (default `file`) |
| `FALLBACK_COST_PER_KG_ORE` | nej | kr/kg i øre brugt hvis hverken fil-API eller spole har en pris |

## Bekræft mod Bambuddys Swagger (`http://<host>:8000/docs`)

Koden bruger fornuftige defaults + flere sandsynlige feltnavne, men tjek og override hvis
nødvendigt:

- **Spole-endpoint** (`BAMBUDDY_SPOOLS_PATH`) og feltnavne for restvægt / kr/kg / low-stock.
- **Upload-feltnavn** for `POST /api/v1/library/files/upload`.
- **Fil-stats**: hvilke felter `GET /api/v1/library/files/{id}` returnerer (printtid,
  filamentvægt, evt. pris), og om pris er direkte tilgængelig eller skal beregnes fra kr/kg.

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
