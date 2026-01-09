FROM node:20-alpine

# Install dependencies
RUN apk add --no-cache git

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Create vault mount point
RUN mkdir -p /vault

# Expose port
EXPOSE 3000

# Run the server
CMD ["node", "src/index.js"]
