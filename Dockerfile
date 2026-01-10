FROM node:25-alpine

# Install dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Create vault mount point
RUN mkdir -p /vault

# Expose port
EXPOSE 3000

# Run the server
CMD ["node", "dist/index.js"]
