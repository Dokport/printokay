FROM node:20-alpine
WORKDIR /app
COPY package.json ./
# No dependencies — uses Node's built-in fetch/FormData/Blob.
COPY index.js ./
CMD ["node", "index.js"]
