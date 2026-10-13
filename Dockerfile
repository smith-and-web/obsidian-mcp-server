FROM node:26-alpine

# Install dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code and SQL schema
COPY src/ ./src/
COPY sql/ ./sql/

# Build TypeScript
RUN npm run build

# Create vault mount point
RUN mkdir -p /vault

# Expose port
EXPOSE 3000

# Run the server. For the indexer: command: ["node", "dist/indexer.js"]
CMD ["node", "dist/index.js"]
