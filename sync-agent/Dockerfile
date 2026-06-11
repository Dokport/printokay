FROM node:20-alpine
WORKDIR /app
COPY package.json ./

# index.js hentes fra GitHub ved container-start, så en opdatering er bare:
#   push til main  →  Portainer: restart container
# Ingen rebuild, ingen filimport.
CMD sh -c "\
  wget -qO index.js \
    https://raw.githubusercontent.com/Dokport/printokay/main/sync-agent/index.js \
  && node index.js"
