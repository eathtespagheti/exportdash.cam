# Stage 1: Dependencies and Build
#
# The builder image is pinned to the exact Node patch version recorded in
# .nvmrc, so the container build, the CI pipeline and a local checkout all
# use the same toolchain. Bumping it is a deliberate, reviewable change -
# see the dependency-update tooling issue.
FROM node:26.12.1-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 2: Production with nginx
FROM nginx:alpine AS runner

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy static files from builder
COPY --from=builder /app/out /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
