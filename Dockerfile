FROM node:20-alpine AS builder

WORKDIR /build

# Copy backend additions
COPY backend-additions ./backend-additions
COPY tsconfig.json ./

WORKDIR /build/backend-additions
RUN npm install && npm run build

# Runtime stage
FROM node:20-alpine

WORKDIR /app

# Copy built backend
COPY --from=builder /build/backend-additions/dist ./dist
COPY --from=builder /build/backend-additions/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

EXPOSE 3000

CMD ["node", "dist/index.js"]
