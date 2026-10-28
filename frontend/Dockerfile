# [SEC-20261022-NODEPIN] build stage on Node 22.23.4 (October 2026 security release);
# Node 20 is end-of-life and got no fix. Node runs at BUILD time only — the runtime is nginx.
# revert: FROM node:20-alpine AS build
FROM node:22.23.4-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
